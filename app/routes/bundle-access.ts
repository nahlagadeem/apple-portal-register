import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { getBundleCollectionAccessForEmail } from "../institutes";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

type AppProxySession = {
  customerEmail?: string;
  loggedInCustomerId?: string | number;
  session?: {
    shop?: string;
    customerId?: string | number;
    onlineAccessInfo?: {
      associated_user?: {
        email?: string;
        id?: string | number;
      };
    };
  };
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
}

function normalizeShopDomain(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = String(input).trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const withProtocol = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).hostname.trim().toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0].trim().toLowerCase();
  }
}

function normalizeCustomerEmail(input: string | null | undefined): string {
  return String(input || "").trim().toLowerCase();
}

function normalizeCustomerId(input: string | number | null | undefined): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const gidMatch = raw.match(/\/(\d+)$/);
  if (gidMatch?.[1]) return gidMatch[1];
  return raw.replace(/\D/g, "") || raw;
}

async function getShopifyAdmin(shop: string) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    return admin;
  } catch {
    const offlineSession = await prisma.session.findFirst({
      where: { shop, isOnline: false },
    });
    const token = String(offlineSession?.accessToken || "").trim();
    if (!token) throw new Error(`No offline session for ${shop}.`);

    return {
      graphql: async (query: string, opts: { variables?: Record<string, unknown> } = {}) =>
        fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({ query, variables: opts.variables || {} }),
        }),
    };
  }
}

async function resolveEmailFromCustomerId(shop: string, customerId: string) {
  if (!shop || !customerId) return "";
  const admin = await getShopifyAdmin(shop);
  const response = await admin.graphql(
    `
      query CustomerEmail($id: ID!) {
        customer(id: $id) {
          id
          email
        }
      }
    `,
    { variables: { id: `gid://shopify/Customer/${customerId}` } }
  );
  const body = await response.json().catch(() => null);
  return normalizeCustomerEmail(body?.data?.customer?.email);
}

async function ensureCustomerAccessTags(shop: string, customerEmail: string, customerId: string) {
  if (!shop || !customerEmail || !customerId) return;

  const admin = await getShopifyAdmin(shop);
  const response = await admin.graphql(
    `
      query CustomerTags($id: ID!) {
        customer(id: $id) {
          id
          tags
        }
      }
    `,
    { variables: { id: `gid://shopify/Customer/${customerId}` } }
  );
  const body = await response.json().catch(() => null);
  const tags = new Set<string>(
    Array.isArray(body?.data?.customer?.tags)
      ? body.data.customer.tags.map((tag: unknown) => String(tag || "").trim()).filter(Boolean)
      : [],
  );
  const access = getBundleCollectionAccessForEmail(customerEmail, "all-bundles");
  if (!access.allowed) return;

  tags.add("bundle_access_all-bundles");
  if (access.instituteKey) tags.add(`institute_${access.instituteKey}`);

  const updateResponse = await admin.graphql(
    `
      mutation UpdateCustomerTags($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        input: {
          id: `gid://shopify/Customer/${customerId}`,
          tags: Array.from(tags),
        },
      },
    }
  );
  const updateBody = await updateResponse.json().catch(() => null);
  const userErrors = updateBody?.data?.customerUpdate?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(userErrors.map((error: { message?: string }) => String(error?.message || "")).filter(Boolean).join("; "));
  }
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const collectionHandle = String(url.searchParams.get("collection") || "all-bundles").trim() || "all-bundles";
  const shop = normalizeShopDomain(
    url.searchParams.get("shop") ||
      request.headers.get("x-shopify-shop-domain") ||
      request.headers.get("x-shop-domain"),
  );

  let proxyVerified = false;
  let customerEmail = normalizeCustomerEmail(url.searchParams.get("customer_email"));
  let loggedInCustomerId = normalizeCustomerId(url.searchParams.get("logged_in_customer_id") || url.searchParams.get("customer_id"));

  try {
    const proxy = (await authenticate.public.appProxy(request)) as AppProxySession;
    proxyVerified = true;
    customerEmail =
      customerEmail ||
      normalizeCustomerEmail(
        proxy?.customerEmail || proxy?.session?.onlineAccessInfo?.associated_user?.email,
      );
    loggedInCustomerId =
      loggedInCustomerId ||
      normalizeCustomerId(
        proxy?.loggedInCustomerId ||
          proxy?.session?.customerId ||
          proxy?.session?.onlineAccessInfo?.associated_user?.id,
      );
  } catch {
    // Allow direct requests for local/debug flows.
  }

  if (!proxyVerified) {
    return json({ ok: false, allowed: false, error: "Invalid proxy signature." }, { status: 401 });
  }

  if (!customerEmail && shop && loggedInCustomerId) {
    try {
      customerEmail = await resolveEmailFromCustomerId(shop, loggedInCustomerId);
    } catch {
      customerEmail = "";
    }
  }

  if (!customerEmail) {
    return json({ ok: false, allowed: false, error: "Missing customer email." }, { status: 401 });
  }

  const verification = shop
    ? await prisma.schoolEmailVerification.findFirst({
        where: {
          shop,
          accountEmail: customerEmail,
        },
        orderBy: { verifiedAt: "desc" },
      }).catch(() => null)
    : null;
  const eligibilityEmail = normalizeCustomerEmail(verification?.schoolEmail) || customerEmail;
  const access = getBundleCollectionAccessForEmail(eligibilityEmail, collectionHandle);
  if (access.allowed && shop && loggedInCustomerId) {
    try {
      await ensureCustomerAccessTags(shop, eligibilityEmail, loggedInCustomerId);
    } catch {
      // Tag sync is best effort; authorization still comes from the signed request and domain check.
    }
  }
  return json({
    ok: true,
    shop,
    proxyVerified,
    customerEmail,
    eligibilityEmail,
    schoolEmailVerified: Boolean(verification),
    ...access,
  });
}

export async function loader({ request }: { request: Request }) {
  return handle(request);
}

export async function action({ request }: { request: Request }) {
  return handle(request);
}

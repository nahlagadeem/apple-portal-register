import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { clearUserSession, ensurePortalUserTable, getUserId, hashPassword, normalizeRole, normalizeSaudiPhone, verifyPassword } from "../portal-auth.server";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

type PortalUserRecord = {
  id: number;
  fullName: string;
  email: string;
  institute: string;
  role: string;
  roleOther: string | null;
  phoneSa: string | null;
  passwordHash: string;
};

type ShopifyAddress = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

function normalizeShopDomain(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = String(input).trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const withProtocol =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`;
    return new URL(withProtocol).hostname.trim().toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0].trim().toLowerCase();
  }
}

function splitName(fullName: string) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function getAdminForShop(shop: string) {
  try {
    const { admin } = await unauthenticated.admin(shop);
    return admin;
  } catch (e) {
    const offlineSession = await prisma.session.findFirst({
      where: { shop, isOnline: false },
    });
    const token = String(offlineSession?.accessToken || "").trim();
    if (!token) throw e;

    return {
      graphql: async (query: string, opts: any = {}) =>
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

async function shopifyGraphql(admin: any, query: string, variables: Record<string, unknown> = {}) {
  const response = await admin.graphql(query, { variables });
  const bodyText = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(`Shopify Admin HTTP ${response.status}: ${bodyText}`);
  if (body?.errors?.length) throw new Error(body.errors.map((x: any) => x.message).join(", "));
  return body;
}

async function getShopifyCustomerById(admin: any, loggedInCustomerId: string) {
  const customerGid = `gid://shopify/Customer/${loggedInCustomerId}`;
  const customerResp = await shopifyGraphql(
    admin,
    `
      query CustomerById($id: ID!) {
        customer(id: $id) {
          id
          email
          defaultAddress {
            address1
            address2
            city
            province
            zip
            country
          }
        }
      }
    `,
    { id: customerGid }
  );

  return customerResp?.data?.customer ?? null;
}

async function getShopifyCustomerByEmail(admin: any, email: string) {
  const found = await shopifyGraphql(
    admin,
    `
      query FindCustomerByEmail($q: String!) {
        customers(first: 1, query: $q) {
          edges {
            node {
              id
              email
              defaultAddress {
                address1
                address2
                city
                province
                zip
                country
              }
            }
          }
        }
      }
    `,
    { q: `email:${email}` }
  );

  return found?.data?.customers?.edges?.[0]?.node ?? null;
}

async function resolvePortalUserFromSessionOrShopify(
  request: Request
): Promise<{ user: PortalUserRecord; shop: string; address: ShopifyAddress | null } | null> {
  const url = new URL(request.url);
  const shop = normalizeShopDomain(url.searchParams.get("shop") || env.LIVE_SHOP_DOMAIN);
  const loggedInCustomerId = String(url.searchParams.get("logged_in_customer_id") || "").trim();

  const sessionUserId = await getUserId(request);
  if (sessionUserId) {
    const user = await prisma.portalUser.findUnique({ where: { id: sessionUserId } });
    if (user) {
      if (shop) {
        try {
          const admin = await getAdminForShop(shop);
          const customer = loggedInCustomerId
            ? await getShopifyCustomerById(admin, loggedInCustomerId)
            : await getShopifyCustomerByEmail(admin, user.email);
          return { user: user as PortalUserRecord, shop, address: customer?.defaultAddress ?? null };
        } catch {
          return { user: user as PortalUserRecord, shop, address: null };
        }
      }
      return { user: user as PortalUserRecord, shop: "", address: null };
    }
  }

  if (!shop || !loggedInCustomerId) return null;

  const admin = await getAdminForShop(shop);
  const customer = await getShopifyCustomerById(admin, loggedInCustomerId);
  const customerEmail = String(customer?.email || "").trim().toLowerCase();
  if (!customerEmail) return null;

  const user = await prisma.portalUser.findUnique({ where: { email: customerEmail } });
  if (!user) return null;
  return { user: user as PortalUserRecord, shop, address: customer?.defaultAddress ?? null };
}

async function syncShopifyCustomerProfile({
  shop,
  email,
  fullName,
  institute,
  role,
  roleOther,
  phoneSa,
  address1,
  address2,
  city,
  province,
  zip,
  country,
}: {
  shop: string;
  email: string;
  fullName: string;
  institute: string;
  role: string;
  roleOther: string;
  phoneSa: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  country: string;
}) {
  if (!shop) return;
  const admin = await getAdminForShop(shop);
  const found = await shopifyGraphql(
    admin,
    `
      query FindCustomerByEmail($q: String!) {
        customers(first: 1, query: $q) {
          edges { node { id } }
        }
      }
    `,
    { q: `email:${email}` }
  );
  const customerId = found?.data?.customers?.edges?.[0]?.node?.id;
  if (!customerId) return;

  const { firstName, lastName } = splitName(fullName);
  const noteLines = [
    `Registered via student portal`,
    `Institute: ${institute}`,
    `Role: ${role}${role === "other" && roleOther ? ` (${roleOther})` : ""}`,
  ];

  await shopifyGraphql(
    admin,
    `
      mutation CustomerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }
    `,
    {
      input: {
        id: customerId,
        firstName,
        lastName: lastName || undefined,
        phone: phoneSa || undefined,
        note: noteLines.join("\n"),
        tags: ["student_portal"],
        addresses: [
          {
            address1: address1 || undefined,
            address2: address2 || undefined,
            city: city || undefined,
            province: province || undefined,
            zip: zip || undefined,
            country: country || undefined,
            phone: phoneSa || undefined,
          },
        ],
      },
    }
  );
}

export async function loader({ request }: { request: Request }) {
  await ensurePortalUserTable();
  const resolved = await resolvePortalUserFromSessionOrShopify(request);
  if (!resolved) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { user, address } = resolved;
  return json({
    ok: true,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      institute: user.institute,
      role: user.role,
      roleOther: user.roleOther,
      phoneSa: user.phoneSa,
      address: {
        address1: address?.address1 || "",
        address2: address?.address2 || "",
        city: address?.city || "",
        province: address?.province || "",
        zip: address?.zip || "",
        country: address?.country || "",
      },
    },
  });
}

export async function action({ request }: { request: Request }) {
  await ensurePortalUserTable();
  const resolved = await resolvePortalUserFromSessionOrShopify(request);
  if (!resolved) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { user, shop } = resolved;
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "logout") {
    const sessionUserId = await getUserId(request);
    if (sessionUserId) {
      const response = await clearUserSession(request);
      return json(
        { ok: true, loggedOut: true },
        { headers: { "Set-Cookie": response.headers.get("Set-Cookie") || "" } }
      );
    }
    return json({ ok: true, loggedOut: true });
  }

  if (intent === "update-profile") {
    const fullName = String(formData.get("fullName") || "").trim();
    const institute = String(formData.get("institute") || "").trim();
    const role = normalizeRole(formData.get("role"));
    const roleOther = String(formData.get("roleOther") || "").trim();
    const phoneSa = normalizeSaudiPhone(formData.get("phoneSa"));
    const address1 = String(formData.get("address1") || "").trim();
    const address2 = String(formData.get("address2") || "").trim();
    const city = String(formData.get("city") || "").trim();
    const province = String(formData.get("province") || "").trim();
    const zip = String(formData.get("zip") || "").trim();
    const country = String(formData.get("country") || "").trim();

    const errors = {
      fullName: fullName ? "" : "Full name is required.",
      institute: institute ? "" : "Institute is required.",
      role: role ? "" : "Role is required.",
      roleOther: role === "other" && !roleOther ? "Please specify role." : "",
      phoneSa: phoneSa === null ? "Use 05XXXXXXXX or +9665XXXXXXXX." : "",
    };
    if (Object.values(errors).some(Boolean)) return json({ ok: false, section: "profile", errors }, { status: 400 });
    if (!shop) {
      return json(
        { ok: false, section: "profile", message: "Missing shop context for Shopify sync." },
        { status: 400 }
      );
    }

    await syncShopifyCustomerProfile({
      shop,
      email: user.email,
      fullName,
      institute,
      role,
      roleOther,
      phoneSa: phoneSa || "",
      address1,
      address2,
      city,
      province,
      zip,
      country,
    });

    await prisma.portalUser.update({
      where: { id: user.id },
      data: {
        fullName,
        institute,
        role,
        roleOther: role === "other" ? roleOther : null,
        phoneSa: phoneSa || null,
      },
    });

    return json({ ok: true, section: "profile", message: "Profile updated." });
  }

  if (intent === "change-password") {
    const currentPassword = String(formData.get("currentPassword") || "");
    const newPassword = String(formData.get("newPassword") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    const errors = {
      currentPassword: verifyPassword(currentPassword, user.passwordHash) ? "" : "Current password is incorrect.",
      newPassword: newPassword.length >= 6 ? "" : "New password must be at least 6 characters.",
      confirmPassword: newPassword === confirmPassword ? "" : "Passwords do not match.",
    };
    if (Object.values(errors).some(Boolean)) return json({ ok: false, section: "password", errors }, { status: 400 });

    await prisma.portalUser.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword) },
    });

    return json({ ok: true, section: "password", message: "Password updated." });
  }

  return json({ ok: false, error: "Unknown action." }, { status: 400 });
}

import { authenticate } from "../shopify.server";
import { getBundleCollectionAccessForEmail } from "../institutes";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

type AppProxySession = {
  customerEmail?: string;
  session?: {
    onlineAccessInfo?: {
      associated_user?: {
        email?: string;
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

  try {
    const proxy = (await authenticate.public.appProxy(request)) as AppProxySession;
    proxyVerified = true;
    customerEmail = customerEmail || normalizeCustomerEmail(proxy?.customerEmail || proxy?.session?.onlineAccessInfo?.associated_user?.email);
  } catch {
    // Allow direct requests for local/debug flows.
  }

  if (!customerEmail) {
    return json({ ok: false, allowed: false, error: "Missing customer email." }, { status: 401 });
  }

  const access = getBundleCollectionAccessForEmail(customerEmail, collectionHandle);
  return json({
    ok: true,
    shop,
    proxyVerified,
    customerEmail,
    ...access,
  });
}

export async function loader({ request }: { request: Request }) {
  return handle(request);
}

export async function action({ request }: { request: Request }) {
  return handle(request);
}

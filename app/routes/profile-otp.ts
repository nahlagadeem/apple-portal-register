import { redirect } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  createUserSession,
  ensurePortalUserTable,
  ensureProfileOtpDraftTable,
  hashPassword,
  normalizeEmail,
  normalizeRole,
  normalizeSaudiPhone,
  withPathPrefix,
} from "../portal-auth.server";

const env =
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env ?? {};

type AppProxySession = {
  shop?: string;
  destination?: string;
  customerId?: string;
  onlineAccessInfo?: {
    associated_user?: {
      id?: string;
      email?: string;
    };
  };
};

type AppProxyContext = {
  session?: AppProxySession;
  shop?: string;
  loggedInCustomerId?: string;
  customerEmail?: string;
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function normalizeReturnTo(value: string | null | undefined, fallback = "/pages/student-profile") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("://")) return fallback;
  return raw;
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

function normalizeCustomerId(input: string | null | undefined): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const gidMatch = raw.match(/\/(\d+)$/);
  if (gidMatch?.[1]) return gidMatch[1];
  return raw.replace(/\D/g, "") || raw;
}

function buildNativeOtpUrl(shop: string, loginHint: string, returnTo: string) {
  const relativeReturnTo = normalizeReturnTo(returnTo, "/");
  const loginPath = `/account/login?return_to=${encodeURIComponent(
    relativeReturnTo
  )}&login_hint=${encodeURIComponent(loginHint)}&ui_hint=full`;
  return `https://${shop}${loginPath}`;
}

async function resolveShopAndCustomerContext(request: Request) {
  const url = new URL(request.url);
  const queryShop = normalizeShopDomain(url.searchParams.get("shop"));
  const queryCustomerId = normalizeCustomerId(
    url.searchParams.get("logged_in_customer_id") || url.searchParams.get("customer_id")
  );
  const queryCustomerEmail = normalizeEmail(url.searchParams.get("customer_email"));

  const headerShop = normalizeShopDomain(
    request.headers.get("x-shopify-shop-domain") || request.headers.get("x-shop-domain")
  );
  const headerCustomerId = normalizeCustomerId(
    request.headers.get("x-shopify-logged-in-customer-id") ||
      request.headers.get("x-shopify-customer-id") ||
      request.headers.get("x-customer-id")
  );
  const headerCustomerEmail = normalizeEmail(
    request.headers.get("x-shopify-customer-email") || request.headers.get("x-customer-email")
  );

  let proxyShop = "";
  let proxyCustomerId = "";
  let proxyCustomerEmail = "";
  try {
    const proxy = (await authenticate.public.appProxy(request)) as AppProxyContext;
    const proxySession = proxy?.session;
    proxyShop = normalizeShopDomain(
      proxySession?.shop || proxySession?.destination?.replace(/^https?:\/\//, "") || proxy?.shop
    );
    proxyCustomerId = normalizeCustomerId(
      proxySession?.customerId || proxySession?.onlineAccessInfo?.associated_user?.id || proxy?.loggedInCustomerId
    );
    proxyCustomerEmail = normalizeEmail(
      proxySession?.onlineAccessInfo?.associated_user?.email || proxy?.customerEmail
    );
  } catch {
    // Continue with query/header fallback paths.
  }

  return {
    shop: queryShop || headerShop || proxyShop || normalizeShopDomain(env.LIVE_SHOP_DOMAIN),
    loggedInCustomerId: queryCustomerId || headerCustomerId || proxyCustomerId,
    customerEmail: queryCustomerEmail || headerCustomerEmail || proxyCustomerEmail,
  };
}

function normalizeRedirectUrl(shop: string, returnTo: string) {
  return `https://${shop}${normalizeReturnTo(returnTo, "/")}`;
}

export async function loader({ request }: { request: Request }) {
  await ensurePortalUserTable();
  await ensureProfileOtpDraftTable();

  const url = new URL(request.url);
  const draftToken = String(url.searchParams.get("draft_token") || "").trim();
  if (!draftToken) {
    return redirect(withPathPrefix(request, "/register"));
  }

  const draft = await prisma.profileOtpDraft.findUnique({
    where: { draftToken },
  });
  if (!draft) {
    return redirect(withPathPrefix(request, "/register?otp=invalid"));
  }

  const expired = draft.expiresAt ? new Date(draft.expiresAt).getTime() < Date.now() : false;
  if (expired) {
    await prisma.profileOtpDraft.update({
      where: { id: draft.id },
      data: { status: "expired" },
    });
    return redirect(withPathPrefix(request, "/register?otp=expired"));
  }

  const context = await resolveShopAndCustomerContext(request);
  const shop = normalizeShopDomain(context.shop || draft.shop);
  const customerEmail = normalizeEmail(context.customerEmail);
  const customerId = normalizeCustomerId(context.loggedInCustomerId);

  if (!shop || shop !== draft.shop) {
    return redirect(withPathPrefix(request, "/register?otp=invalid"));
  }

  if (draft.status === "completed") {
    return redirect(normalizeRedirectUrl(shop, draft.returnTo || "/"));
  }

  if (!customerEmail && !customerId) {
    return redirect(
      buildNativeOtpUrl(shop, draft.schoolEmail || draft.customerEmail || draft.nativeEmail || "", withPathPrefix(request, `/profile-otp?draft_token=${draftToken}`))
    );
  }

  const emailMatches = customerEmail && customerEmail === draft.customerEmail;
  const customerMatches = customerId && draft.customerId && customerId === draft.customerId;

  if (customerEmail && !emailMatches && !customerMatches) {
    return redirect(withPathPrefix(request, `/register?otp=invalid&draft_token=${draftToken}`));
  }

  if (!emailMatches && !customerMatches) {
    return redirect(
      buildNativeOtpUrl(
        shop,
        draft.schoolEmail || draft.customerEmail || draft.nativeEmail || "",
        withPathPrefix(request, `/profile-otp?draft_token=${draftToken}`)
      )
    );
  }

  const existing = await prisma.portalUser.findUnique({
    where: { email: draft.schoolEmail },
  });

  const user = existing
    ? await prisma.portalUser.update({
        where: { id: existing.id },
        data: {
          fullName: draft.fullName,
          email: draft.schoolEmail,
          schoolEmail: draft.schoolEmail,
          institute: draft.institute,
          role: normalizeRole(draft.role),
          roleOther: draft.role === "other" ? draft.roleOther : null,
          phoneSa: normalizeSaudiPhone(draft.phoneSa) || null,
          passwordHash: draft.passwordHash || existing.passwordHash || hashPassword(draftToken),
        },
      })
    : await prisma.portalUser.create({
        data: {
          fullName: draft.fullName,
          email: draft.schoolEmail,
          schoolEmail: draft.schoolEmail,
          institute: draft.institute,
          role: normalizeRole(draft.role),
          roleOther: draft.role === "other" ? draft.roleOther : null,
          phoneSa: normalizeSaudiPhone(draft.phoneSa) || null,
          passwordHash: draft.passwordHash || hashPassword(draftToken),
        },
      });

  await prisma.profileOtpDraft.update({
    where: { id: draft.id },
    data: {
      status: "completed",
      verifiedAt: new Date(),
      customerId: customerId || draft.customerId,
      customerEmail: customerEmail || draft.customerEmail,
      nativeEmail: draft.nativeEmail || customerEmail || null,
      fullName: draft.fullName,
      schoolEmail: draft.schoolEmail,
      institute: draft.institute,
      role: draft.role,
      roleOther: draft.roleOther,
      phoneSa: draft.phoneSa,
      passwordHash: draft.passwordHash,
    },
  });

  await prisma.profilePromptState.deleteMany({
    where: {
      shop,
      customerEmail: draft.schoolEmail,
    },
  });

  return createUserSession(user.id, normalizeReturnTo(draft.returnTo, "/"));
}

export async function action() {
  return json({ ok: false, error: "Method not allowed" }, { status: 405 });
}

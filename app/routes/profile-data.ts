import prisma from "../db.server";
import { getInstituteByEmail, getInstituteByKey, getInstituteCustomerTags, getBundleCollectionAccessForEmail } from "../institutes";
import { authenticate, unauthenticated } from "../shopify.server";
import { clearUserSession, ensurePortalUserTable, getUserId, hashPassword, normalizeRole, normalizeSaudiPhone, verifyPassword } from "../portal-auth.server";
/* eslint-disable @typescript-eslint/no-explicit-any */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

type PortalUserRecord = {
  id: number;
  fullName: string;
  email: string;
  schoolEmail: string | null;
  institute: string;
  role: string;
  roleOther: string | null;
  phoneSa: string | null;
  passwordHash: string;
};

type ShopifyAddress = {
  id?: string | null;
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
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

function normalizeCustomerId(input: string | null | undefined): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const gidMatch = raw.match(/\/(\d+)$/);
  if (gidMatch?.[1]) return gidMatch[1];
  return raw.replace(/\D/g, "") || raw;
}

async function resolveShopAndCustomerContext(request: Request) {
  const url = new URL(request.url);
  const queryShop = normalizeShopDomain(url.searchParams.get("shop"));
  const queryCustomerId = normalizeCustomerId(
    url.searchParams.get("logged_in_customer_id") || url.searchParams.get("customer_id")
  );
  const queryCustomerEmail = String(url.searchParams.get("customer_email") || "")
    .trim()
    .toLowerCase();

  const headerShop = normalizeShopDomain(
    request.headers.get("x-shopify-shop-domain") || request.headers.get("x-shop-domain")
  );
  const headerCustomerId = normalizeCustomerId(
    request.headers.get("x-shopify-logged-in-customer-id") ||
      request.headers.get("x-shopify-customer-id") ||
      request.headers.get("x-customer-id")
  );
  const headerCustomerEmail = String(
    request.headers.get("x-shopify-customer-email") || request.headers.get("x-customer-email") || ""
  )
    .trim()
    .toLowerCase();

  let proxyShop = "";
  let proxyCustomerId = "";
  let proxyCustomerEmail = "";
  try {
    const proxy = (await authenticate.public.appProxy(request)) as any;
    const proxySession = proxy?.session as any;
    proxyShop = normalizeShopDomain(
      proxySession?.shop ||
        proxySession?.destination?.replace(/^https?:\/\//, "") ||
        proxy?.shop
    );
    proxyCustomerId = normalizeCustomerId(
      proxySession?.customerId ||
        proxySession?.onlineAccessInfo?.associated_user?.id ||
        proxy?.loggedInCustomerId
    );
    proxyCustomerEmail = String(
      proxySession?.onlineAccessInfo?.associated_user?.email || proxy?.customerEmail || ""
    )
      .trim()
      .toLowerCase();
  } catch {
    // continue with query/header fallback paths
  }

  return {
    shop: queryShop || headerShop || proxyShop || normalizeShopDomain(env.LIVE_SHOP_DOMAIN),
    loggedInCustomerId: queryCustomerId || headerCustomerId || proxyCustomerId,
    customerEmail: queryCustomerEmail || headerCustomerEmail || proxyCustomerEmail,
  };
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
    const token = String(
      offlineSession?.accessToken ||
        env.SHOPIFY_ADMIN_TOKEN ||
        env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
        ""
    ).trim();
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

function cleanAddress(address: any): ShopifyAddress {
  return {
    id: String(address?.id || ""),
    name: String(address?.name || ""),
    address1: String(address?.address1 || ""),
    address2: String(address?.address2 || ""),
    city: String(address?.city || ""),
    province: String(address?.province || ""),
    zip: String(address?.zip || ""),
    country: String(address?.country || ""),
    phone: String(address?.phone || ""),
  };
}

function sortAddressesWithDefaultFirst(addresses: ShopifyAddress[], defaultAddressId: string) {
  if (!defaultAddressId) return addresses;
  return [...addresses].sort((a, b) => {
    const aDefault = String(a.id || "") === defaultAddressId ? 1 : 0;
    const bDefault = String(b.id || "") === defaultAddressId ? 1 : 0;
    return bDefault - aDefault;
  });
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
            id
            name
            address1
            address2
            city
            province
            zip
            country
            phone
          }
          addresses(first: 50) {
            edges {
              node {
                id
                name
                address1
                address2
                city
                province
                zip
                country
                phone
              }
            }
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
                id
                name
                address1
                address2
                city
                province
                zip
                country
                phone
              }
              addresses(first: 50) {
                edges {
                  node {
                    id
                    name
                    address1
                    address2
                    city
                    province
                    zip
                    country
                    phone
                  }
                }
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
): Promise<{
  user: PortalUserRecord;
  shop: string;
  customerId: string;
  defaultAddress: ShopifyAddress | null;
  addresses: ShopifyAddress[];
} | null> {
  const { shop, loggedInCustomerId, customerEmail } = await resolveShopAndCustomerContext(request);

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
          const defaultAddress = customer?.defaultAddress ? cleanAddress(customer.defaultAddress) : null;
          const defaultAddressId = String(defaultAddress?.id || "");
          const addresses = Array.isArray(customer?.addresses?.edges)
            ? customer.addresses.edges.map((edge: any) => cleanAddress(edge?.node))
            : [];
          return {
            user: user as PortalUserRecord,
            shop,
            customerId: String(customer?.id || ""),
            defaultAddress,
            addresses: sortAddressesWithDefaultFirst(addresses, defaultAddressId),
          };
        } catch {
          return {
            user: user as PortalUserRecord,
            shop,
            customerId: "",
            defaultAddress: null,
            addresses: [],
          };
        }
      }
      return {
        user: user as PortalUserRecord,
        shop: "",
        customerId: "",
        defaultAddress: null,
        addresses: [],
      };
    }
  }

  if (!shop) return null;

  if (customerEmail && !loggedInCustomerId) {
    const user = await prisma.portalUser.findUnique({ where: { email: customerEmail } });
    if (user) {
      return {
        user: user as PortalUserRecord,
        shop,
        customerId: "",
        defaultAddress: null,
        addresses: [],
      };
    }
  }

  if (!loggedInCustomerId && customerEmail) {
    try {
      const admin = await getAdminForShop(shop);
      const customer = await getShopifyCustomerByEmail(admin, customerEmail);
      const normalizedEmail = String(customer?.email || customerEmail).trim().toLowerCase();
      if (!normalizedEmail) return null;

      const user = await prisma.portalUser.findUnique({ where: { email: normalizedEmail } });
      if (!user) return null;

      const defaultAddress = customer?.defaultAddress ? cleanAddress(customer.defaultAddress) : null;
      const defaultAddressId = String(defaultAddress?.id || "");
      const addresses = Array.isArray(customer?.addresses?.edges)
        ? customer.addresses.edges.map((edge: any) => cleanAddress(edge?.node))
        : [];
      return {
        user: user as PortalUserRecord,
        shop,
        customerId: String(customer?.id || ""),
        defaultAddress,
        addresses: sortAddressesWithDefaultFirst(addresses, defaultAddressId),
      };
    } catch {
      const user = await prisma.portalUser.findUnique({ where: { email: customerEmail } });
      if (!user) return null;
      return {
        user: user as PortalUserRecord,
        shop,
        customerId: "",
        defaultAddress: null,
        addresses: [],
      };
    }
  }

  if (!loggedInCustomerId) return null;

  try {
    const admin = await getAdminForShop(shop);
    const customer = await getShopifyCustomerById(admin, loggedInCustomerId);
    const customerEmail = String(customer?.email || "").trim().toLowerCase();
    if (!customerEmail) return null;

    const user = await prisma.portalUser.findUnique({ where: { email: customerEmail } });
    if (!user) return null;
    const defaultAddress = customer?.defaultAddress ? cleanAddress(customer.defaultAddress) : null;
    const defaultAddressId = String(defaultAddress?.id || "");
    const addresses = Array.isArray(customer?.addresses?.edges)
      ? customer.addresses.edges.map((edge: any) => cleanAddress(edge?.node))
      : [];
    return {
      user: user as PortalUserRecord,
      shop,
      customerId: String(customer?.id || ""),
      defaultAddress,
      addresses: sortAddressesWithDefaultFirst(addresses, defaultAddressId),
    };
  } catch {
    if (!customerEmail) return null;
    const user = await prisma.portalUser.findUnique({ where: { email: customerEmail } });
    if (!user) return null;
    return {
      user: user as PortalUserRecord,
      shop,
      customerId: loggedInCustomerId ? `gid://shopify/Customer/${loggedInCustomerId}` : "",
      defaultAddress: null,
      addresses: [],
    };
  }
}

async function getProfilePromptState(
  shop: string,
  customerEmail: string,
  loggedInCustomerId: string
) {
  if (!shop || !customerEmail) return null;

  const state = await prisma.profilePromptState.findUnique({
    where: {
      shop_customerEmail: {
        shop,
        customerEmail,
      },
    },
  });

  if (!state) return null;

  if (!state.customerId && loggedInCustomerId) {
    return prisma.profilePromptState.update({
      where: { id: state.id },
      data: { customerId: loggedInCustomerId },
    });
  }

  return state;
}

async function syncShopifyCustomerProfile({
  shop,
  customerId,
  customerEmail,
  fullName,
  institute,
  role,
  roleOther,
  phoneSa,
}: {
  shop: string;
  customerId: string;
  customerEmail: string;
  fullName: string;
  institute: string;
  role: string;
  roleOther: string;
  phoneSa: string;
}) {
  if (!shop || !customerId) return;
  const admin = await getAdminForShop(shop);

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
        tags: getInstituteCustomerTags(getInstituteByEmail(customerEmail)?.key || ""),
      },
    }
  );
}

function readAddressInput(formData: FormData) {
  return {
    firstName: String(formData.get("firstName") || "").trim(),
    lastName: String(formData.get("lastName") || "").trim(),
    address1: String(formData.get("address1") || "").trim(),
    address2: String(formData.get("address2") || "").trim(),
    city: String(formData.get("city") || "").trim(),
    zip: String(formData.get("zip") || "").trim(),
    country: String(formData.get("country") || "").trim(),
    phone: normalizeSaudiPhone(formData.get("phoneSa")) || undefined,
    isDefault: String(formData.get("isDefault") || "") === "true",
  };
}

function validateAddressInput(address: ReturnType<typeof readAddressInput>) {
  return {
    address1: address.address1 ? "" : "Address line 1 is required.",
    city: address.city ? "" : "City is required.",
    country: address.country ? "" : "Country is required.",
  };
}

async function addCustomerAddress(admin: any, customerId: string, address: ReturnType<typeof readAddressInput>) {
  const { isDefault, ...addressInput } = address;
  const result = await shopifyGraphql(
    admin,
    `
      mutation AddCustomerAddress($customerId: ID!, $address: MailingAddressInput!) {
        customerAddressCreate(customerId: $customerId, address: $address) {
          customerAddress {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { customerId, address: addressInput }
  );
  const errors = result?.data?.customerAddressCreate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((x: any) => x.message).join(", "));

  const createdAddressId = String(result?.data?.customerAddressCreate?.customerAddress?.id || "");
  if (isDefault && createdAddressId) {
    const defaultResult = await shopifyGraphql(
      admin,
      `
        mutation SetCustomerDefaultAddress($customerId: ID!, $addressId: ID!) {
          customerDefaultAddressUpdate(customerId: $customerId, addressId: $addressId) {
            customer {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      { customerId, addressId: createdAddressId }
    );
    const defaultErrors = defaultResult?.data?.customerDefaultAddressUpdate?.userErrors || [];
    if (defaultErrors.length) throw new Error(defaultErrors.map((x: any) => x.message).join(", "));
  }
}

export async function loader({ request }: { request: Request }) {
  await ensurePortalUserTable();
  const context = await resolveShopAndCustomerContext(request);
  const resolved = await resolvePortalUserFromSessionOrShopify(request);
  if (!resolved) {
    if (!context.shop || !context.customerEmail) {
      return json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const promptState = await getProfilePromptState(
      context.shop,
      context.customerEmail,
      context.loggedInCustomerId
    );

    return json({
      ok: true,
      user: null,
      hasPortalProfile: false,
      skippedProfilePrompt: Boolean(promptState?.skippedAt),
      shouldPromptProfileCompletion: !promptState?.skippedAt,
    });
  }

  const { user, defaultAddress, addresses } = resolved;
  const promptState = await getProfilePromptState(
    resolved.shop,
    user.email,
    normalizeCustomerId(resolved.customerId)
  );
  return json({
    ok: true,
    hasPortalProfile: true,
    skippedProfilePrompt: Boolean(promptState?.skippedAt),
    shouldPromptProfileCompletion: false,
    bundleCollectionAccess: getBundleCollectionAccessForEmail(user.email),
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      schoolEmail: user.schoolEmail,
      institute: user.institute,
      role: user.role,
      roleOther: user.roleOther,
      phoneSa: user.phoneSa,
      defaultAddress,
      addresses,
    },
  });
}

export async function action({ request }: { request: Request }) {
  await ensurePortalUserTable();
  const resolved = await resolvePortalUserFromSessionOrShopify(request);
  if (!resolved) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { user, shop, customerId } = resolved;
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
    const instituteKey = String(formData.get("institute") || "").trim();
    const institute = getInstituteByKey(instituteKey);
    const role = normalizeRole(formData.get("role"));
    const roleOther = String(formData.get("roleOther") || "").trim();
    const phoneSa = normalizeSaudiPhone(formData.get("phoneSa"));
    const matchingInstitute = getInstituteByEmail(user.email);

    const errors = {
      fullName: fullName ? "" : "Full name is required.",
      institute: institute ? "" : "Please choose an institute.",
      role: role ? "" : "Role is required.",
      roleOther: role === "other" && !roleOther ? "Please specify role." : "",
      phoneSa: phoneSa === null ? "Use 05XXXXXXXX or +9665XXXXXXXX." : "",
    };
    if (!errors.institute && matchingInstitute && matchingInstitute.key !== institute?.key) {
      errors.institute = `This account must use ${matchingInstitute.domain}.`;
    }
    if (Object.values(errors).some(Boolean)) return json({ ok: false, section: "profile", errors }, { status: 400 });
    if (!institute) {
      return json({ ok: false, section: "profile", errors }, { status: 400 });
    }
    if (!shop) {
      return json(
        { ok: false, section: "profile", message: "Missing shop context for Shopify sync." },
        { status: 400 }
      );
    }

    await prisma.portalUser.update({
      where: { id: user.id },
      data: {
        fullName,
        institute: institute.label,
        role,
        roleOther: role === "other" ? roleOther : null,
        phoneSa: phoneSa || null,
      },
    });

    await syncShopifyCustomerProfile({
      shop,
      customerId,
      customerEmail: user.email,
      fullName,
      institute: institute.label,
      role,
      roleOther,
      phoneSa: phoneSa || "",
    }).catch((error: unknown) => {
      console.warn("Shopify customer sync failed after portal profile update", {
        shop,
        customerId,
        email: user.email,
        error: String((error as Error)?.message || error),
      });
    });

    return json({
      ok: true,
      section: "profile",
      message: "Profile updated.",
      bundleCollectionAccess: getBundleCollectionAccessForEmail(user.email),
    });
  }

  if (intent === "add-address") {
    if (!shop || !customerId) {
      return json({ ok: false, section: "address", message: "Missing shop context for address update." }, { status: 400 });
    }

    const address = readAddressInput(formData);
    const errors = validateAddressInput(address);
    if (Object.values(errors).some(Boolean)) {
      return json({ ok: false, section: "address", errors }, { status: 400 });
    }

    const admin = await getAdminForShop(shop);
    await addCustomerAddress(admin, customerId, address);
    return json({ ok: true, section: "address", message: "Address added." });
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

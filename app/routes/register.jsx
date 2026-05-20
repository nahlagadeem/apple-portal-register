import { useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import crypto from "node:crypto";
import prisma from "../db.server";
import {
  buildInstituteOptions,
  getInstituteByKey,
  normalizeEmailLocalPart,
} from "../institutes";
import { unauthenticated } from "../shopify.server";
import {
  createUserSession,
  ensurePortalUserTable,
  ensureProfileOtpDraftTable,
  getUserId,
  hashPassword,
  normalizeEmail,
  normalizeRole,
  normalizeSaudiPhone,
  withPathPrefix,
} from "../portal-auth.server";

const env = (globalThis.process && globalThis.process.env) || {};
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const INSTITUTE_OPTIONS = buildInstituteOptions();

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getEmailLocalPart(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email.includes("@")) return email;
  return email.split("@")[0];
}

function normalizeEmailDomain(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const normalized = raw.startsWith("@") ? raw : `@${raw.replace(/^@+/, "")}`;
  if (!/^@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)) return null;
  return normalized;
}

function normalizeReturnTo(value, fallback = "/pages/student-profile") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("://")) return fallback;
  return raw;
}

function buildNativeOtpUrl(shop, loginHint, returnTo) {
  const relativeReturnTo = normalizeReturnTo(returnTo, "/");
  const loginPath = `/customer_authentication/login?return_to=${encodeURIComponent(
    relativeReturnTo
  )}&login_hint=${encodeURIComponent(loginHint)}`;
  return `https://${shop}${loginPath}`;
}

function normalizeShopDomain(input) {
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

function normalizeCustomerId(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const gidMatch = raw.match(/\/(\d+)$/);
  if (gidMatch?.[1]) return gidMatch[1];
  return raw.replace(/\D/g, "") || raw;
}

function wantsJson(request) {
  const url = new URL(request.url);
  const accept = String(request.headers.get("accept") || "").toLowerCase();
  const requestedWith = String(request.headers.get("x-requested-with") || "").toLowerCase();
  const forceJson = url.searchParams.get("response") === "json" || url.searchParams.get("ajax") === "1";
  return forceJson || accept.includes("application/json") || requestedWith === "xmlhttprequest";
}

function getStorefrontContext(request, formData) {
  const requestUrl = new URL(request.url);
  return {
    shop: normalizeShopDomain(
      requestUrl.searchParams.get("shop") ||
        formData.get("shop") ||
        request.headers.get("x-shopify-shop-domain") ||
        request.headers.get("x-shop-domain") ||
        env.LIVE_SHOP_DOMAIN
    ),
    customerEmail: normalizeEmail(
      formData.get("email") ||
        requestUrl.searchParams.get("customer_email") ||
        request.headers.get("x-shopify-customer-email") ||
        request.headers.get("x-customer-email")
    ),
    loggedInCustomerId: normalizeCustomerId(
      requestUrl.searchParams.get("logged_in_customer_id") ||
        requestUrl.searchParams.get("customer_id") ||
        formData.get("logged_in_customer_id") ||
        formData.get("customer_id") ||
        request.headers.get("x-shopify-logged-in-customer-id") ||
        request.headers.get("x-shopify-customer-id") ||
        request.headers.get("x-customer-id")
    ),
  };
}

function splitName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

async function getAdminForShop(shop) {
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
      graphql: async (query, opts = {}) =>
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

async function shopifyGraphql(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });
  const bodyText = await response.text();
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(`Shopify Admin HTTP ${response.status}: ${bodyText}`);
  }
  if (body?.errors?.length) {
    throw new Error(body.errors.map((x) => x.message).join(", "));
  }
  return body;
}

async function ensureShopifyCustomer({
  shop,
  email,
  fullName,
  phoneSa,
  institute,
  role,
  roleOther,
}) {
  const admin = await getAdminForShop(shop);
  const emailQuery = `email:${email}`;
  const findCustomerQuery = `
    query FindCustomerByEmail($q: String!) {
      customers(first: 1, query: $q) {
        edges {
          node { id email }
        }
      }
    }
  `;

  const found = await shopifyGraphql(admin, findCustomerQuery, { q: emailQuery });
  const existingId = found?.data?.customers?.edges?.[0]?.node?.id;
  if (existingId) return existingId;

  const { firstName, lastName } = splitName(fullName);
  const noteLines = [
    `Registered via student portal`,
    `Institute: ${institute}`,
    `Role: ${role}${role === "other" && roleOther ? ` (${roleOther})` : ""}`,
  ];
  const createCustomerMutation = `
    mutation CustomerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id email }
        userErrors { field message }
      }
    }
  `;

  const created = await shopifyGraphql(admin, createCustomerMutation, {
    input: {
      email,
      firstName,
      lastName: lastName || undefined,
      phone: phoneSa || undefined,
      tags: ["student_portal"],
      note: noteLines.join("\n"),
    },
  });

  const userErrors = created?.data?.customerCreate?.userErrors || [];
  if (userErrors.length) {
    const message = userErrors.map((x) => x.message).join(", ");
    throw new Error(message || "Unable to create Shopify customer");
  }

  return created?.data?.customerCreate?.customer?.id || null;
}

export async function loader({ request }) {
  const userId = await getUserId(request);
  const pathPrefix = withPathPrefix(request, "").replace(/\/$/, "");
  const url = new URL(request.url);
  const returnTo = normalizeReturnTo(url.searchParams.get("return_to"));
  if (userId) throw redirect(returnTo);
  return { pathPrefix };
}

export async function action({ request }) {
  const jsonMode = wantsJson(request);
  const pathPrefix = withPathPrefix(request, "").replace(/\/$/, "");
  const errors = {
    fullName: "",
    email: "",
    institute: "",
    role: "",
    roleOther: "",
    phoneSa: "",
    password: "",
    confirmPassword: "",
    general: "",
  };
  const values = {
    fullName: "",
    emailLocalPart: "",
    emailDomain: "",
    instituteKey: "",
    role: "student",
    roleOther: "",
    phoneSa: "",
  };

  try {
    await ensurePortalUserTable();
    await ensureProfileOtpDraftTable();
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "register");
    const fullName = String(formData.get("fullName") || "").trim();
    const instituteKey = String(formData.get("institute") || "").trim();
    const institute = getInstituteByKey(instituteKey);
    const rawEmail = normalizeEmail(formData.get("email"));
    const normalizedLocalPart = normalizeEmailLocalPart(
      formData.get("emailLocalPart") || getEmailLocalPart(rawEmail)
    );
    const emailDomain = normalizeEmailDomain(
      formData.get("emailDomain") || institute?.domain || ""
    );
    const schoolEmail = normalizeEmail(
      normalizedLocalPart && emailDomain ? `${normalizedLocalPart}${emailDomain}` : ""
    );
    const finalEmail = schoolEmail || rawEmail;
    const role = normalizeRole(formData.get("role"));
    const roleOther = String(formData.get("roleOther") || "").trim();
    const phoneSa = normalizeSaudiPhone(formData.get("phoneSa"));
    const returnTo =
      intent === "complete-native-profile"
        ? normalizeReturnTo(formData.get("return_to"), "/")
        : normalizeReturnTo(formData.get("return_to"));
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    values.fullName = fullName;
    values.emailLocalPart =
      normalizedLocalPart === null ? String(formData.get("emailLocalPart") || "").trim() : normalizedLocalPart;
    values.emailDomain = emailDomain || String(formData.get("emailDomain") || "").trim();
    values.instituteKey = instituteKey;
    values.role = role || "student";
    values.roleOther = roleOther;
    values.phoneSa = String(formData.get("phoneSa") || "").trim();

    const {
      shop,
      customerEmail: storefrontCustomerEmail,
      loggedInCustomerId,
    } = getStorefrontContext(request, formData);
    if (!shop) {
      errors.general = "Missing shop context. Open this form from your storefront.";
      if (jsonMode) return json({ ok: false, errors }, { status: 400 });
      return { ok: false, errors, pathPrefix };
    }

    if (intent === "skip-native-profile") {
      const skipEmail = storefrontCustomerEmail || rawEmail || finalEmail;
      errors.email = isValidEmail(skipEmail) ? "" : "Valid email is required.";
      if (errors.email) {
        if (jsonMode) return json({ ok: false, errors }, { status: 400 });
        return { ok: false, errors, pathPrefix };
      }

      await prisma.profilePromptState.upsert({
        where: {
          shop_customerEmail: {
            shop,
            customerEmail: skipEmail,
          },
        },
        update: {
          customerId: loggedInCustomerId || null,
          skippedAt: new Date(),
        },
        create: {
          shop,
          customerEmail: skipEmail,
          customerId: loggedInCustomerId || null,
          skippedAt: new Date(),
        },
      });

      if (jsonMode) {
        return json({
          ok: true,
          skipped: true,
          redirectUrl: `https://${shop}${returnTo || "/"}`,
        });
      }

      return redirect(returnTo || "/");
    }

    errors.fullName = fullName ? "" : "Full name is required.";
    errors.institute = institute ? "" : "Please choose an institute.";
    errors.email =
      normalizedLocalPart === null
        ? "Use only the part before @ in your school email."
        : normalizedLocalPart
          ? ""
          : "Email username is required.";
    if (!errors.email && !isValidEmail(schoolEmail)) {
      errors.email = "Use a valid school email domain.";
    }
    errors.role = role ? "" : "Role is required.";
    errors.roleOther = role === "other" && !roleOther ? "Please specify role." : "";
    errors.phoneSa = phoneSa === null ? "Use 05XXXXXXXX or +9665XXXXXXXX." : "";
    errors.password =
      intent === "complete-native-profile" || password.length >= 6
        ? ""
        : "Password must be at least 6 characters.";
    errors.confirmPassword =
      intent === "complete-native-profile" || password === confirmPassword
        ? ""
        : "Passwords do not match.";

    if (Object.values(errors).some(Boolean)) {
      if (jsonMode) return json({ ok: false, errors }, { status: 400 });
      return { ok: false, errors, pathPrefix, values };
    }

    const existing = await prisma.portalUser.findUnique({ where: { email: finalEmail } });
    if (intent !== "complete-native-profile" && existing) {
      errors.email = "Email is already registered.";
      if (jsonMode) return json({ ok: false, errors }, { status: 409 });
      return { ok: false, errors, pathPrefix, values };
    }

    if (intent === "complete-native-profile") {
      const draftToken = crypto.randomUUID();
      const callbackReturnTo = withPathPrefix(request, `/profile-otp?draft_token=${draftToken}`);

      await prisma.profileOtpDraft.upsert({
        where: {
          shop_customerEmail: {
            shop,
            customerEmail: finalEmail,
          },
        },
        update: {
          draftToken,
          nativeEmail: storefrontCustomerEmail || rawEmail || null,
          customerId: loggedInCustomerId || null,
          fullName,
          schoolEmail: finalEmail,
          institute: institute.label,
          role,
          roleOther: role === "other" ? roleOther : null,
          phoneSa: phoneSa || null,
          passwordHash: hashPassword(password),
          returnTo,
          status: "pending_otp",
          verifiedAt: null,
          expiresAt: new Date(Date.now() + 1000 * 60 * 30),
        },
        create: {
          draftToken,
          shop,
          customerEmail: finalEmail,
          nativeEmail: storefrontCustomerEmail || rawEmail || null,
          customerId: loggedInCustomerId || null,
          fullName,
          schoolEmail: finalEmail,
          institute: institute.label,
          role,
          roleOther: role === "other" ? roleOther : null,
          phoneSa: phoneSa || null,
          passwordHash: hashPassword(password),
          returnTo,
          status: "pending_otp",
          expiresAt: new Date(Date.now() + 1000 * 60 * 30),
        },
      });

      const redirectUrl = buildNativeOtpUrl(shop, finalEmail, callbackReturnTo);
      if (jsonMode) return json({ ok: true, redirectUrl });
      return redirect(redirectUrl);
    }

    await ensureShopifyCustomer({
      shop,
      email: finalEmail,
      fullName,
      phoneSa,
      institute: institute.label,
      role,
      roleOther,
    });

    const user =
      existing
        ? await prisma.portalUser.update({
            where: { id: existing.id },
            data: {
              fullName,
              email: finalEmail,
              schoolEmail: schoolEmail || null,
              institute: institute.label,
              role,
              roleOther: role === "other" ? roleOther : null,
              phoneSa: phoneSa || null,
              passwordHash: hashPassword(password),
            },
          })
        : await prisma.portalUser.create({
            data: {
              fullName,
              email: finalEmail,
              schoolEmail: schoolEmail || null,
              institute: institute.label,
              role,
              roleOther: role === "other" ? roleOther : null,
              phoneSa: phoneSa || null,
              passwordHash: hashPassword(password),
            },
          });

    await prisma.profilePromptState.deleteMany({
      where: {
        shop,
        customerEmail: finalEmail,
      },
    });

    if (jsonMode) {
      return json({
        ok: true,
        redirectUrl: `https://${shop}/account/login`,
      });
    }

    return createUserSession(user.id, returnTo);
  } catch (e) {
    errors.general = `Registration failed. ${String(e?.message || e)}`;
    if (jsonMode) return json({ ok: false, errors }, { status: 500 });
    return { ok: false, errors, pathPrefix, values };
  }
}

export default function RegisterPage() {
  const { pathPrefix } = useLoaderData();
  const data = useActionData();
  const errors = data?.errors || {};
  const linkBase = data?.pathPrefix ?? pathPrefix ?? "";
  const values = data?.values || {
    fullName: "",
    emailLocalPart: "",
    emailDomain: "",
    instituteKey: "",
    role: "student",
    roleOther: "",
    phoneSa: "",
  };
  const [selectedInstituteKey, setSelectedInstituteKey] = useState(values.instituteKey || "");
  const selectedInstitute = getInstituteByKey(selectedInstituteKey);

  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 16 }}>
      <h1>Register</h1>
      <Form method="post">
        <p>
          <label>
            Full name
            <br />
            <input name="fullName" type="text" defaultValue={values.fullName} />
          </label>
          {errors.fullName ? <small style={{ color: "red" }}>{errors.fullName}</small> : null}
        </p>
        <p>
          <label>
            Institute
            <br />
            <select
              name="institute"
              value={selectedInstituteKey}
              onChange={(event) => setSelectedInstituteKey(event.target.value)}
            >
              <option value="">Choose your institute</option>
              {Object.entries(INSTITUTE_OPTIONS).map(([segment, institutes]) => (
                <optgroup key={segment} label={segment}>
                  {institutes.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {errors.institute ? <small style={{ color: "red" }}>{errors.institute}</small> : null}
        </p>
        <p>
          <label>
            School email
            <br />
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                name="emailLocalPart"
                type="text"
                placeholder="Enter the part before @"
                defaultValue={values.emailLocalPart}
                style={{ flex: "1 1 220px" }}
              />
              <input
                name="emailDomain"
                type="text"
                placeholder="@school-domain"
                defaultValue={values.emailDomain || selectedInstitute?.domain || "@school-domain"}
                style={{
                  minWidth: 180,
                  padding: "8px 10px",
                  background: "#fff",
                  border: "1px solid #ccc",
                  borderRadius: 4,
                }}
              />
            </span>
          </label>
          {errors.email ? <small style={{ color: "red" }}>{errors.email}</small> : null}
        </p>
        <p>
          <label>
            Role
            <br />
            <select name="role" defaultValue={values.role || "student"}>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              <option value="parent">Parent</option>
              <option value="other">Other</option>
            </select>
          </label>
          {errors.role ? <small style={{ color: "red" }}>{errors.role}</small> : null}
        </p>
        <p>
          <label>
            Role (if Other)
            <br />
            <input name="roleOther" type="text" defaultValue={values.roleOther} />
          </label>
          {errors.roleOther ? <small style={{ color: "red" }}>{errors.roleOther}</small> : null}
        </p>
        <p>
          <label>
            Saudi phone (optional)
            <br />
            <input
              name="phoneSa"
              type="text"
              placeholder="05XXXXXXXX or +9665XXXXXXXX"
              defaultValue={values.phoneSa}
            />
          </label>
          {errors.phoneSa ? <small style={{ color: "red" }}>{errors.phoneSa}</small> : null}
        </p>
        <p>
          <label>
            Password
            <br />
            <input name="password" type="password" />
          </label>
          {errors.password ? <small style={{ color: "red" }}>{errors.password}</small> : null}
        </p>
        <p>
          <label>
            Confirm password
            <br />
            <input name="confirmPassword" type="password" />
          </label>
          {errors.confirmPassword ? (
            <small style={{ color: "red" }}>{errors.confirmPassword}</small>
          ) : null}
        </p>
        <button type="submit">Create account</button>
      </Form>
      {errors.general ? <p style={{ color: "red" }}>{errors.general}</p> : null}
      <p style={{ marginTop: 12 }}>
        Already have account? <Link to={`${linkBase}/login`}>Login</Link>
      </p>
    </main>
  );
}

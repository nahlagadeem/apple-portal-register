import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  createUserSession,
  ensurePortalUserTable,
  getUserId,
  hashPassword,
  normalizeEmail,
  normalizeRole,
  normalizeSaudiPhone,
  withPathPrefix,
} from "../portal-auth.server";

const env = (globalThis.process && globalThis.process.env) || {};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
  if (userId) throw redirect(withPathPrefix(request, "/profile"));
  return { pathPrefix };
}

export async function action({ request }) {
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

  try {
    await ensurePortalUserTable();
    const formData = await request.formData();
    const fullName = String(formData.get("fullName") || "").trim();
    const email = normalizeEmail(formData.get("email"));
    const institute = String(formData.get("institute") || "").trim();
    const role = normalizeRole(formData.get("role"));
    const roleOther = String(formData.get("roleOther") || "").trim();
    const phoneSa = normalizeSaudiPhone(formData.get("phoneSa"));
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    errors.fullName = fullName ? "" : "Full name is required.";
    errors.email = isValidEmail(email) ? "" : "Valid email is required.";
    errors.institute = institute ? "" : "Institute name is required.";
    errors.role = role ? "" : "Role is required.";
    errors.roleOther = role === "other" && !roleOther ? "Please specify role." : "";
    errors.phoneSa = phoneSa === null ? "Use 05XXXXXXXX or +9665XXXXXXXX." : "";
    errors.password = password.length >= 6 ? "" : "Password must be at least 6 characters.";
    errors.confirmPassword = password === confirmPassword ? "" : "Passwords do not match.";

    if (Object.values(errors).some(Boolean)) return { ok: false, errors, pathPrefix };

    const existing = await prisma.portalUser.findUnique({ where: { email } });
    if (existing) {
      errors.email = "Email is already registered.";
      return { ok: false, errors, pathPrefix };
    }

    const requestUrl = new URL(request.url);
    const shop = normalizeShopDomain(
      requestUrl.searchParams.get("shop") || env.LIVE_SHOP_DOMAIN
    );
    if (!shop) {
      errors.general = "Missing shop context. Open this form from your storefront.";
      return { ok: false, errors, pathPrefix };
    }

    await ensureShopifyCustomer({
      shop,
      email,
      fullName,
      phoneSa,
      institute,
      role,
      roleOther,
    });

    const user = await prisma.portalUser.create({
      data: {
        fullName,
        email,
        institute,
        role,
        roleOther: role === "other" ? roleOther : null,
        phoneSa: phoneSa || null,
        passwordHash: hashPassword(password),
      },
    });

    return createUserSession(user.id, withPathPrefix(request, "/profile"));
  } catch (e) {
    errors.general = `Registration failed. ${String(e?.message || e)}`;
    return { ok: false, errors, pathPrefix };
  }
}

export default function RegisterPage() {
  const { pathPrefix } = useLoaderData();
  const data = useActionData();
  const errors = data?.errors || {};
  const linkBase = data?.pathPrefix ?? pathPrefix ?? "";

  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 16 }}>
      <h1>Register</h1>
      <Form method="post">
        <p>
          <label>
            Full name
            <br />
            <input name="fullName" type="text" />
          </label>
          {errors.fullName ? <small style={{ color: "red" }}>{errors.fullName}</small> : null}
        </p>
        <p>
          <label>
            Email
            <br />
            <input name="email" type="email" />
          </label>
          {errors.email ? <small style={{ color: "red" }}>{errors.email}</small> : null}
        </p>
        <p>
          <label>
            Institute
            <br />
            <input name="institute" type="text" />
          </label>
          {errors.institute ? <small style={{ color: "red" }}>{errors.institute}</small> : null}
        </p>
        <p>
          <label>
            Role
            <br />
            <select name="role" defaultValue="student">
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
            <input name="roleOther" type="text" />
          </label>
          {errors.roleOther ? <small style={{ color: "red" }}>{errors.roleOther}</small> : null}
        </p>
        <p>
          <label>
            Saudi phone (optional)
            <br />
            <input name="phoneSa" type="text" placeholder="05XXXXXXXX or +9665XXXXXXXX" />
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

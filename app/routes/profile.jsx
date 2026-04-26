import { useState } from "react";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import {
  buildInstituteOptions,
  getInstituteByEmail,
  getInstituteByKey,
  getInstituteByLabel,
} from "../institutes";
import { unauthenticated } from "../shopify.server";
import {
  clearUserSession,
  ensurePortalUserTable,
  hashPassword,
  normalizeRole,
  normalizeSaudiPhone,
  requireUserId,
  verifyPassword,
  withPathPrefix,
} from "../portal-auth.server";

const env = (globalThis.process && globalThis.process.env) || {};
const INSTITUTE_OPTIONS = buildInstituteOptions();

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
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
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
  if (!response.ok) throw new Error(`Shopify Admin HTTP ${response.status}: ${bodyText}`);
  if (body?.errors?.length) throw new Error(body.errors.map((x) => x.message).join(", "));
  return body;
}

async function syncShopifyCustomerProfile({ shop, email, fullName, institute, role, roleOther, phoneSa }) {
  const admin = await getAdminForShop(shop);
  const find = await shopifyGraphql(
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

  const customerId = find?.data?.customers?.edges?.[0]?.node?.id;
  if (!customerId) throw new Error("Shopify customer not found for this email.");

  const { firstName, lastName } = splitName(fullName);
  const noteLines = [
    `Registered via student portal`,
    `Institute: ${institute}`,
    `Role: ${role}${role === "other" && roleOther ? ` (${roleOther})` : ""}`,
  ];

  const updated = await shopifyGraphql(
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
      },
    }
  );

  const userErrors = updated?.data?.customerUpdate?.userErrors || [];
  if (userErrors.length) throw new Error(userErrors.map((x) => x.message).join(", "));
}

export async function loader({ request }) {
  await ensurePortalUserTable();
  const userId = await requireUserId(request);
  const user = await prisma.portalUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      institute: true,
      role: true,
      roleOther: true,
      phoneSa: true,
      passwordHash: true,
    },
  });

  if (!user) return clearUserSession(request);
  return {
    pathPrefix: withPathPrefix(request, "").replace(/\/$/, ""),
    user: { ...user, passwordHash: undefined },
  };
}

export async function action({ request }) {
  await ensurePortalUserTable();
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "logout") return clearUserSession(request);

  if (intent === "update-profile") {
    const currentUser = await prisma.portalUser.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!currentUser) return clearUserSession(request);

    const fullName = String(formData.get("fullName") || "").trim();
    const instituteKey = String(formData.get("institute") || "").trim();
    const institute = getInstituteByKey(instituteKey);
    const role = normalizeRole(formData.get("role"));
    const roleOther = String(formData.get("roleOther") || "").trim();
    const phoneSa = normalizeSaudiPhone(formData.get("phoneSa"));
    const matchingInstitute = getInstituteByEmail(currentUser.email);

    const errors = {
      fullName: fullName ? "" : "Full name is required.",
      institute: institute ? "" : "Please choose an institute.",
      role: role ? "" : "Role is required.",
      roleOther: role === "other" && !roleOther ? "Please specify role." : "",
      phoneSa: phoneSa === null ? "Use 05XXXXXXXX or +9665XXXXXXXX." : "",
    };
    if (!errors.institute && matchingInstitute && matchingInstitute.key !== institute.key) {
      errors.institute = `This account must use ${matchingInstitute.domain}.`;
    }

    if (Object.values(errors).some(Boolean)) return { ok: false, section: "profile", errors };

    const shop = normalizeShopDomain(url.searchParams.get("shop") || env.LIVE_SHOP_DOMAIN);
    if (!shop) {
      return { ok: false, section: "profile", errors, message: "Missing shop context." };
    }

    try {
      await syncShopifyCustomerProfile({
        shop,
        email: currentUser.email,
        fullName,
        institute: institute.label,
        role,
        roleOther,
        phoneSa,
      });
    } catch (e) {
      return {
        ok: false,
        section: "profile",
        errors,
        message: `Shopify sync failed: ${String(e?.message || e)}`,
      };
    }

    await prisma.portalUser.update({
      where: { id: userId },
      data: {
        fullName,
        institute: institute.label,
        role,
        roleOther: role === "other" ? roleOther : null,
        phoneSa: phoneSa || null,
      },
    });

    return { ok: true, section: "profile", message: "Profile updated." };
  }

  if (intent === "change-password") {
    const currentPassword = String(formData.get("currentPassword") || "");
    const newPassword = String(formData.get("newPassword") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    const user = await prisma.portalUser.findUnique({ where: { id: userId } });
    if (!user) return clearUserSession(request);

    const errors = {
      currentPassword: verifyPassword(currentPassword, user.passwordHash) ? "" : "Current password is incorrect.",
      newPassword: newPassword.length >= 6 ? "" : "New password must be at least 6 characters.",
      confirmPassword: newPassword === confirmPassword ? "" : "Passwords do not match.",
    };

    if (Object.values(errors).some(Boolean)) return { ok: false, section: "password", errors };

    await prisma.portalUser.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(newPassword) },
    });

    return { ok: true, section: "password", message: "Password updated." };
  }

  return { ok: false, section: "general", message: "Unknown action." };
}

export default function ProfilePage() {
  const { pathPrefix, user } = useLoaderData();
  const actionData = useActionData();
  const errors = actionData?.errors || {};
  const linkBase = actionData?.pathPrefix ?? pathPrefix ?? "";
  const initialInstitute =
    getInstituteByEmail(user.email) ||
    getInstituteByLabel(user.institute);
  const [selectedInstituteKey, setSelectedInstituteKey] = useState(initialInstitute?.key || "");
  const selectedInstitute = getInstituteByKey(selectedInstituteKey);

  return (
    <main style={{ maxWidth: 640, margin: "40px auto", padding: 16 }}>
      <h1>My Profile</h1>
      {actionData?.message ? <p style={{ color: actionData.ok ? "green" : "red" }}>{actionData.message}</p> : null}

      <Form method="post">
        <input type="hidden" name="intent" value="update-profile" />
        <p>
          <label>
            Full name
            <br />
            <input name="fullName" type="text" defaultValue={user.fullName} />
          </label>
          {errors.fullName ? <small style={{ color: "red" }}>{errors.fullName}</small> : null}
        </p>
        <p>
          <label>
            Email (read-only)
            <br />
            <input name="email" type="email" defaultValue={user.email} disabled />
          </label>
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
          {selectedInstitute ? (
            <small style={{ display: "block", marginTop: 6 }}>
              School email domain: {selectedInstitute.domain}
            </small>
          ) : null}
        </p>
        <p>
          <label>
            Role
            <br />
            <select name="role" defaultValue={user.role}>
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
            <input name="roleOther" type="text" defaultValue={user.roleOther || ""} />
          </label>
          {errors.roleOther ? <small style={{ color: "red" }}>{errors.roleOther}</small> : null}
        </p>
        <p>
          <label>
            Saudi phone (optional)
            <br />
            <input name="phoneSa" type="text" defaultValue={user.phoneSa || ""} />
          </label>
          {errors.phoneSa ? <small style={{ color: "red" }}>{errors.phoneSa}</small> : null}
        </p>
        <button type="submit">Save profile</button>
      </Form>

      <hr style={{ margin: "24px 0" }} />

      <h2>Change Password</h2>
      <Form method="post">
        <input type="hidden" name="intent" value="change-password" />
        <p>
          <label>
            Current password
            <br />
            <input name="currentPassword" type="password" />
          </label>
          {errors.currentPassword ? <small style={{ color: "red" }}>{errors.currentPassword}</small> : null}
        </p>
        <p>
          <label>
            New password
            <br />
            <input name="newPassword" type="password" />
          </label>
          {errors.newPassword ? <small style={{ color: "red" }}>{errors.newPassword}</small> : null}
        </p>
        <p>
          <label>
            Confirm new password
            <br />
            <input name="confirmPassword" type="password" />
          </label>
          {errors.confirmPassword ? <small style={{ color: "red" }}>{errors.confirmPassword}</small> : null}
        </p>
        <button type="submit">Update password</button>
      </Form>

      <hr style={{ margin: "24px 0" }} />

      <Form method="post">
        <input type="hidden" name="intent" value="logout" />
        <button type="submit">Logout</button>
      </Form>

      <p style={{ marginTop: 12 }}>
        <Link to={`${linkBase}/register`}>Register another account</Link>
      </p>
    </main>
  );
}

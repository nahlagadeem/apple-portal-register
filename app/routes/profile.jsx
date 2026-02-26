import { Form, Link, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import {
  clearUserSession,
  ensurePortalUserTable,
  hashPassword,
  normalizeRole,
  normalizeSaudiPhone,
  requireUserId,
  verifyPassword,
} from "../portal-auth.server";

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
  return { user: { ...user, passwordHash: undefined } };
}

export async function action({ request }) {
  await ensurePortalUserTable();
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "logout") return clearUserSession(request);

  if (intent === "update-profile") {
    const fullName = String(formData.get("fullName") || "").trim();
    const institute = String(formData.get("institute") || "").trim();
    const role = normalizeRole(formData.get("role"));
    const roleOther = String(formData.get("roleOther") || "").trim();
    const phoneSa = normalizeSaudiPhone(formData.get("phoneSa"));

    const errors = {
      fullName: fullName ? "" : "Full name is required.",
      institute: institute ? "" : "Institute is required.",
      role: role ? "" : "Role is required.",
      roleOther: role === "other" && !roleOther ? "Please specify role." : "",
      phoneSa: phoneSa === null ? "Use 05XXXXXXXX or +9665XXXXXXXX." : "",
    };

    if (Object.values(errors).some(Boolean)) return { ok: false, section: "profile", errors };

    await prisma.portalUser.update({
      where: { id: userId },
      data: {
        fullName,
        institute,
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
  const { user } = useLoaderData();
  const actionData = useActionData();
  const errors = actionData?.errors || {};

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
            <input name="institute" type="text" defaultValue={user.institute} />
          </label>
          {errors.institute ? <small style={{ color: "red" }}>{errors.institute}</small> : null}
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
        <Link to="/register">Register another account</Link>
      </p>
    </main>
  );
}

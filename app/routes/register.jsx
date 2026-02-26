import { Form, Link, redirect, useActionData } from "react-router";
import prisma from "../db.server";
import {
  createUserSession,
  getUserId,
  hashPassword,
  normalizeEmail,
  normalizeRole,
  normalizeSaudiPhone,
} from "../portal-auth.server";

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function loader({ request }) {
  const userId = await getUserId(request);
  if (userId) throw redirect("/profile");
  return null;
}

export async function action({ request }) {
  const formData = await request.formData();
  const fullName = String(formData.get("fullName") || "").trim();
  const email = normalizeEmail(formData.get("email"));
  const institute = String(formData.get("institute") || "").trim();
  const role = normalizeRole(formData.get("role"));
  const roleOther = String(formData.get("roleOther") || "").trim();
  const phoneSa = normalizeSaudiPhone(formData.get("phoneSa"));
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  const errors = {
    fullName: fullName ? "" : "Full name is required.",
    email: isValidEmail(email) ? "" : "Valid email is required.",
    institute: institute ? "" : "Institute name is required.",
    role: role ? "" : "Role is required.",
    roleOther: role === "other" && !roleOther ? "Please specify role." : "",
    phoneSa: phoneSa === null ? "Use 05XXXXXXXX or +9665XXXXXXXX." : "",
    password: password.length >= 6 ? "" : "Password must be at least 6 characters.",
    confirmPassword: password === confirmPassword ? "" : "Passwords do not match.",
    general: "",
  };

  if (Object.values(errors).some(Boolean)) return { ok: false, errors };

  const existing = await prisma.portalUser.findUnique({ where: { email } });
  if (existing) {
    errors.email = "Email is already registered.";
    return { ok: false, errors };
  }

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

  return createUserSession(user.id, "/profile");
}

export default function RegisterPage() {
  const data = useActionData();
  const errors = data?.errors || {};

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
      <p style={{ marginTop: 12 }}>
        Already have account? <Link to="/login">Login</Link>
      </p>
    </main>
  );
}

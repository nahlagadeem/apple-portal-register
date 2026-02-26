import { Form, Link, redirect, useActionData } from "react-router";
import prisma from "../db.server";
import { createUserSession, getUserId, normalizeEmail, verifyPassword } from "../portal-auth.server";

export async function loader({ request }) {
  const userId = await getUserId(request);
  if (userId) throw redirect("/profile");
  return null;
}

export async function action({ request }) {
  const formData = await request.formData();
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") || "");

  if (!email || !password) return { ok: false, error: "Email and password are required." };

  const user = await prisma.portalUser.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "Invalid email or password." };
  }

  return createUserSession(user.id, "/profile");
}

export default function LoginPage() {
  const data = useActionData();
  return (
    <main style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <h1>Login</h1>
      <Form method="post">
        <p>
          <label>
            Email
            <br />
            <input name="email" type="email" />
          </label>
        </p>
        <p>
          <label>
            Password
            <br />
            <input name="password" type="password" />
          </label>
        </p>
        {data?.error ? <p style={{ color: "red" }}>{data.error}</p> : null}
        <button type="submit">Login</button>
      </Form>
      <p style={{ marginTop: 12 }}>
        No account? <Link to="/register">Register</Link>
      </p>
    </main>
  );
}

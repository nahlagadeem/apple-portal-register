import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import {
  createUserSession,
  ensurePortalUserTable,
  getUserId,
  normalizeEmail,
  verifyPassword,
  withPathPrefix,
} from "../portal-auth.server";

export async function loader({ request }) {
  const userId = await getUserId(request);
  const pathPrefix = withPathPrefix(request, "").replace(/\/$/, "");
  if (userId) throw redirect(withPathPrefix(request, "/profile"));
  return { pathPrefix };
}

export async function action({ request }) {
  await ensurePortalUserTable();
  const pathPrefix = withPathPrefix(request, "").replace(/\/$/, "");
  const formData = await request.formData();
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { ok: false, error: "Email and password are required.", pathPrefix };
  }

  const user = await prisma.portalUser.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "Invalid email or password.", pathPrefix };
  }

  return createUserSession(user.id, withPathPrefix(request, "/profile"));
}

export default function LoginPage() {
  const { pathPrefix } = useLoaderData();
  const data = useActionData();
  const linkBase = data?.pathPrefix ?? pathPrefix ?? "";
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
        No account? <Link to={`${linkBase}/register`}>Register</Link>
      </p>
    </main>
  );
}

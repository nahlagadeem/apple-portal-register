import prisma from "../db.server";
import { clearUserSession, ensurePortalUserTable, getUserId } from "../portal-auth.server";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

export async function loader({ request }: { request: Request }) {
  await ensurePortalUserTable();
  const userId = await getUserId(request);
  if (!userId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

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
    },
  });

  if (!user) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return json({ ok: true, user });
}

export async function action({ request }: { request: Request }) {
  await ensurePortalUserTable();
  const userId = await getUserId(request);
  if (!userId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  if (intent === "logout") {
    const response = await clearUserSession(request);
    return json(
      { ok: true, loggedOut: true },
      { headers: { "Set-Cookie": response.headers.get("Set-Cookie") || "" } }
    );
  }

  return json({ ok: false, error: "Unknown action." }, { status: 400 });
}


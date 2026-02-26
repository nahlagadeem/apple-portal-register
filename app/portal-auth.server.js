import crypto from "node:crypto";
import { createCookieSessionStorage, redirect } from "react-router";
import prisma from "./db.server";

const ROLE_VALUES = new Set(["student", "teacher", "parent", "other"]);

const sessionSecret =
  process.env.SESSION_SECRET ||
  process.env.SHOPIFY_API_SECRET ||
  "dev-session-secret-change-me";

const storage = createCookieSessionStorage({
  cookie: {
    name: "portal_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    secrets: [sessionSecret],
    maxAge: 60 * 60 * 24 * 30,
  },
});

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ROLE_VALUES.has(role) ? role : "";
}

export function normalizeSaudiPhone(value) {
  const raw = String(value || "").trim().replace(/\s+/g, "");
  if (!raw) return "";
  if (/^05\d{8}$/.test(raw)) return `+966${raw.slice(1)}`;
  if (/^\+9665\d{8}$/.test(raw)) return raw;
  return null;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedValue) {
  const [salt, storedHash] = String(storedValue || "").split(":");
  if (!salt || !storedHash) return false;
  const incomingHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(incomingHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function getUserId(request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  const userId = session.get("userId");
  return Number.isInteger(userId) ? userId : null;
}

export async function requireUserId(request) {
  const userId = await getUserId(request);
  if (!userId) throw redirect("/login");
  return userId;
}

export async function createUserSession(userId, redirectTo = "/profile") {
  const session = await storage.getSession();
  session.set("userId", userId);
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function clearUserSession(request) {
  const session = await storage.getSession(request.headers.get("Cookie"));
  return redirect("/login", {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

export async function ensurePortalUserTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PortalUser" (
      "id" SERIAL NOT NULL,
      "fullName" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "institute" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "roleOther" TEXT,
      "phoneSa" TEXT,
      "passwordHash" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "PortalUser_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "fullName" TEXT;
    ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "email" TEXT;
    ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "institute" TEXT;
    ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "role" TEXT;
    ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "roleOther" TEXT;
    ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "phoneSa" TEXT;
    ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
    ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "PortalUser" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "PortalUser_email_key" ON "PortalUser"("email");
  `);
}

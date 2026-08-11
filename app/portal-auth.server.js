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

export function getPathPrefix(request) {
  try {
    const url = new URL(request.url);
    const pathPrefix = String(url.searchParams.get("path_prefix") || "").trim();
    if (pathPrefix.startsWith("/apps/")) return pathPrefix.replace(/\/+$/, "");
  } catch {
    // ignore malformed URL and fall back to app routes
  }
  return "";
}

export function withPathPrefix(request, path) {
  const normalizedPath = String(path || "").startsWith("/") ? String(path) : `/${String(path || "")}`;
  const pathPrefix = getPathPrefix(request);
  return pathPrefix ? `${pathPrefix}${normalizedPath}` : normalizedPath;
}

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
  if (!userId) throw redirect(withPathPrefix(request, "/login"));
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
  return redirect(withPathPrefix(request, "/login"), {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

export async function ensurePortalUserTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PortalUser" (
      "id" SERIAL NOT NULL,
      "fullName" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "schoolEmail" TEXT,
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

  await prisma.$executeRawUnsafe(`ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "fullName" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "email" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "schoolEmail" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "institute" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "role" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "roleOther" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "phoneSa" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  );

  await prisma.$executeRawUnsafe(`UPDATE "PortalUser" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL`);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "PortalUser_email_key" ON "PortalUser"("email");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProfilePromptState" (
      "id" SERIAL NOT NULL,
      "shop" TEXT NOT NULL,
      "customerEmail" TEXT NOT NULL,
      "customerId" TEXT,
      "skippedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProfilePromptState_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE "ProfilePromptState" ADD COLUMN IF NOT EXISTS "shop" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ProfilePromptState" ADD COLUMN IF NOT EXISTS "customerEmail" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ProfilePromptState" ADD COLUMN IF NOT EXISTS "customerId" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ProfilePromptState" ADD COLUMN IF NOT EXISTS "skippedAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ProfilePromptState" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ProfilePromptState" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  );

  await prisma.$executeRawUnsafe(
    `UPDATE "ProfilePromptState" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL`
  );

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePromptState_shop_customerEmail_key"
    ON "ProfilePromptState"("shop", "customerEmail");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PendingNativeProfile" (
      "id" SERIAL NOT NULL,
      "token" TEXT NOT NULL,
      "shop" TEXT NOT NULL,
      "originalEmail" TEXT,
      "schoolEmail" TEXT NOT NULL,
      "loggedInCustomerId" TEXT,
      "fullName" TEXT NOT NULL,
      "instituteKey" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "roleOther" TEXT,
      "phoneSa" TEXT,
      "passwordHash" TEXT NOT NULL,
      "returnTo" TEXT NOT NULL,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PendingNativeProfile_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "token" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "shop" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "originalEmail" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "schoolEmail" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "loggedInCustomerId" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "fullName" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "instituteKey" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "role" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "roleOther" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "phoneSa" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "returnTo" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PendingNativeProfile" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`
  );

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "PendingNativeProfile_token_key"
    ON "PendingNativeProfile"("token");
  `);
}

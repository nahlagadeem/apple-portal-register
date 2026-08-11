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

CREATE UNIQUE INDEX IF NOT EXISTS "PendingNativeProfile_token_key"
ON "PendingNativeProfile"("token");

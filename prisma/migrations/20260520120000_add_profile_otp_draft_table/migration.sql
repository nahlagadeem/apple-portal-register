CREATE TABLE IF NOT EXISTS "ProfileOtpDraft" (
    "id" SERIAL NOT NULL,
    "draftToken" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "nativeEmail" TEXT,
    "customerId" TEXT,
    "fullName" TEXT NOT NULL,
    "schoolEmail" TEXT NOT NULL,
    "institute" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "roleOther" TEXT,
    "phoneSa" TEXT,
    "passwordHash" TEXT,
    "returnTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_otp',
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileOtpDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProfileOtpDraft_draftToken_key"
ON "ProfileOtpDraft"("draftToken");

CREATE UNIQUE INDEX IF NOT EXISTS "ProfileOtpDraft_shop_customerEmail_key"
ON "ProfileOtpDraft"("shop", "customerEmail");

CREATE INDEX IF NOT EXISTS "ProfileOtpDraft_shop_status_idx"
ON "ProfileOtpDraft"("shop", "status");

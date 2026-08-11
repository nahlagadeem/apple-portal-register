CREATE TABLE IF NOT EXISTS "SchoolEmailVerification" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "schoolEmail" TEXT NOT NULL,
    "accountCustomerId" TEXT,
    "schoolCustomerId" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolEmailVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SchoolEmailVerification_shop_accountEmail_schoolEmail_key"
ON "SchoolEmailVerification"("shop", "accountEmail", "schoolEmail");

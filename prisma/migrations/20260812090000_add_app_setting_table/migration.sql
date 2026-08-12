CREATE TABLE IF NOT EXISTS "AppSetting" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "schoolEmailOtpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppSetting_shop_key"
ON "AppSetting"("shop");

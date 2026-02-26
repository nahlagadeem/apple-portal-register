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

CREATE UNIQUE INDEX IF NOT EXISTS "PortalUser_email_key" ON "PortalUser"("email");

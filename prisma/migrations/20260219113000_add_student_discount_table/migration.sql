-- CreateTable
CREATE TABLE "StudentDiscount" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentDiscount_shop_customerId_key" ON "StudentDiscount"("shop", "customerId");

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'INVOICE',
    "docId" TEXT,
    "docNumber" TEXT,
    "partyName" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "payeeVpa" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payerUtr" TEXT,
    "payerName" TEXT,
    "claimedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_reference_key" ON "PaymentRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_tokenHash_key" ON "PaymentRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "PaymentRequest_orgId_docId_idx" ON "PaymentRequest"("orgId", "docId");

-- CreateIndex
CREATE INDEX "PaymentRequest_orgId_status_idx" ON "PaymentRequest"("orgId", "status");

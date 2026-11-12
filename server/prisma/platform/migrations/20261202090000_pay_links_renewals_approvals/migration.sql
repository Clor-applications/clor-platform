-- Online payment links and renewal invoices on CLOR's own invoices.
ALTER TABLE "BillingInvoice" ADD COLUMN "payLinkGateway" TEXT;
ALTER TABLE "BillingInvoice" ADD COLUMN "payLinkId" TEXT;
ALTER TABLE "BillingInvoice" ADD COLUMN "payLinkUrl" TEXT;
ALTER TABLE "BillingInvoice" ADD COLUMN "payLinkAmount" INTEGER;
ALTER TABLE "BillingInvoice" ADD COLUMN "payLinkAt" TIMESTAMP(3);
ALTER TABLE "BillingInvoice" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "BillingInvoice" ADD COLUMN "renewalFor" TEXT;
CREATE UNIQUE INDEX "BillingInvoice_accountId_renewalFor_key" ON "BillingInvoice"("accountId", "renewalFor");
CREATE INDEX "BillingInvoice_payLinkId_idx" ON "BillingInvoice"("payLinkId");

-- Changes one operator asks for and a second approves.
CREATE TABLE "OpsApproval" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accountId" TEXT,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "discountPercent" INTEGER,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OpsApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OpsApproval_status_createdAt_idx" ON "OpsApproval"("status", "createdAt");
CREATE INDEX "OpsApproval_accountId_idx" ON "OpsApproval"("accountId");

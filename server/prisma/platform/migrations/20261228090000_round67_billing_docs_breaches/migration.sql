-- Round 67 picks (all additive): purchase order numbers and TDS on CLOR's
-- invoices, proformas, CLOR's vendor documents for procurement, and the Ops
-- record of a customer-data breach.
ALTER TABLE "BillingInvoice" ADD COLUMN IF NOT EXISTS "poNumber" TEXT;
ALTER TABLE "BillingInvoice" ADD COLUMN IF NOT EXISTS "poDate" TEXT;
ALTER TABLE "BillingInvoice" ADD COLUMN IF NOT EXISTS "tdsDeducted" INTEGER;
ALTER TABLE "BillingInvoice" ADD COLUMN IF NOT EXISTS "tdsCertificateAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "BillingPurchaseOrder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "poDate" TEXT,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPurchaseOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BillingPurchaseOrder_accountId_idx" ON "BillingPurchaseOrder"("accountId");

CREATE TABLE IF NOT EXISTS "BillingProforma" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "tax" JSONB NOT NULL DEFAULT '{}',
    "taxTotal" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "buyer" JSONB NOT NULL DEFAULT '{}',
    "seller" JSONB,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "invoiceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingProforma_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BillingProforma_number_key" ON "BillingProforma"("number");
CREATE INDEX IF NOT EXISTS "BillingProforma_accountId_createdAt_idx" ON "BillingProforma"("accountId", "createdAt");

CREATE TABLE IF NOT EXISTS "VendorDocument" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "validUntil" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "VendorDocument_kind_idx" ON "VendorDocument"("kind");

CREATE TABLE IF NOT EXISTS "OpsBreach" (
    "id" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "dataKinds" TEXT NOT NULL,
    "stepsTaken" TEXT NOT NULL,
    "stepsForCustomer" TEXT,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "foundAt" TIMESTAMP(3) NOT NULL,
    "accountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notifiedAt" TIMESTAMP(3),
    "notifiedByUserId" TEXT,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsBreach_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OpsBreach_createdAt_idx" ON "OpsBreach"("createdAt");

-- CLOR staff's own, like notes on a customer: only the operator console,
-- which works outside any company through clor.bypass, sees them.
ALTER TABLE "OpsBreach" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpsBreach" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_only ON "OpsBreach";
CREATE POLICY staff_only ON "OpsBreach"
  USING (current_setting('clor.bypass', true) = 'on')
  WITH CHECK (current_setting('clor.bypass', true) = 'on');

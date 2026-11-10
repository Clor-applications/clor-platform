-- Invoices CLOR raises to its customers (roadmap item 8), with their payment
-- status, and the CLOR Books connector's record of each (item 10). Platform
-- data read and written only by CLOR operators and, for its own issued
-- invoices, the customer account's owner; no tenant policy, like Subscription.
CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "periodStart" TEXT,
    "periodEnd" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "tax" JSONB NOT NULL DEFAULT '{}',
    "taxTotal" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "buyer" JSONB NOT NULL DEFAULT '{}',
    "seller" JSONB,
    "payTo" JSONB,
    "note" TEXT,
    "months" INTEGER NOT NULL DEFAULT 1,
    "paidAt" TIMESTAMP(3),
    "paidAmount" INTEGER,
    "paymentReference" TEXT,
    "paymentEventId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "booksStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
    "booksInvoiceId" TEXT,
    "booksError" TEXT,
    "booksAttempts" INTEGER NOT NULL DEFAULT 0,
    "booksSentAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "issuedByUserId" TEXT,
    "paidByUserId" TEXT,
    "voidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingInvoice_number_key" ON "BillingInvoice"("number");
CREATE INDEX "BillingInvoice_accountId_idx" ON "BillingInvoice"("accountId");
CREATE INDEX "BillingInvoice_status_createdAt_idx" ON "BillingInvoice"("status", "createdAt");

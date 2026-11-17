-- Emailing CLOR's own invoices to customers (billing/invoiceEmail.ts): a
-- record of every email about an invoice, written before the mail goes so the
-- same one is never sent twice, and the reminder state on the invoice itself.
-- Additive only. Platform data with no tenant policy, like BillingInvoice.
ALTER TABLE "BillingInvoice" ADD COLUMN "remindersOff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BillingInvoice" ADD COLUMN "lastRemindedAt" TIMESTAMP(3);
ALTER TABLE "BillingInvoice" ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "BillingInvoiceSend" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'manual',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "toEmail" TEXT NOT NULL,
    "outboxId" TEXT,
    "sentByUserId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingInvoiceSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingInvoiceSend_dedupeKey_key" ON "BillingInvoiceSend"("dedupeKey");
CREATE INDEX "BillingInvoiceSend_invoiceId_createdAt_idx" ON "BillingInvoiceSend"("invoiceId", "createdAt");

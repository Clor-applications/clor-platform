-- Credit notes can be registered on the IRP (audit, 17 Nov 2026). Additive.
ALTER TABLE "CreditNote" ADD COLUMN "irn" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "irnStatus" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "irnAckNo" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "irnAckDate" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "irnSignedQr" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "irnSignedInvoice" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "einvoicePayloadJson" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "irnError" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "irnRegisteredAt" TIMESTAMP(3);

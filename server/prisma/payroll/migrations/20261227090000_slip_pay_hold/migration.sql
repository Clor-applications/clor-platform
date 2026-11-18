-- Hold one person's pay on an approved payroll (round 66 "holdpay"): the slip stays, the bank file leaves it out until released. Additive.
ALTER TABLE "SalarySlip" ADD COLUMN "heldAt" TIMESTAMP(3);
ALTER TABLE "SalarySlip" ADD COLUMN "heldReason" TEXT;
ALTER TABLE "SalarySlip" ADD COLUMN "heldByUserId" TEXT;

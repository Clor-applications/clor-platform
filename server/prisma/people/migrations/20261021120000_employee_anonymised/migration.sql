-- LX-07: when an employee's personal data was erased (anonymised). Null until then.
ALTER TABLE "Employee" ADD COLUMN "anonymisedAt" TIMESTAMP(3);

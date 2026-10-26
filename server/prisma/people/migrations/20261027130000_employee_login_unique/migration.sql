-- One login links to one employee per company (Workforce audit S7). Nulls stay free.
CREATE UNIQUE INDEX "Employee_orgId_userId_key" ON "Employee"("orgId", "userId");

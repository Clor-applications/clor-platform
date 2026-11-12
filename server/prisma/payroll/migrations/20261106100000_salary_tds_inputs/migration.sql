-- Salary TDS on the right amount (6 Nov 2026): a component can be marked as the
-- employer's NPS contribution (section 80CCD(2); 124 of the Income-tax Act
-- 2025), and a tax declaration carries Form 12B — salary, professional tax and
-- TDS from an earlier employer in the same year. Additive: one nullable column
-- and four columns with defaults. No data is changed.

-- AlterTable
ALTER TABLE "SalaryComponent" ADD COLUMN "taxSection" TEXT;

-- AlterTable
ALTER TABLE "TaxDeclaration" ADD COLUMN "previousEmployerName" TEXT,
ADD COLUMN "previousEmployerIncome" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "previousEmployerPt" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "previousEmployerTds" DECIMAL(65,30) NOT NULL DEFAULT 0;

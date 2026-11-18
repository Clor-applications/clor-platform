-- Company card spends (round 51 picks, 18 Nov 2026). Additive; false by default, so every bill stays as it was.
-- paidByCompany: the bill was paid with the company's card; it is claimed for the record and Books, never paid to the person.
ALTER TABLE "ExpenseLine" ADD COLUMN IF NOT EXISTS "paidByCompany" BOOLEAN NOT NULL DEFAULT false;

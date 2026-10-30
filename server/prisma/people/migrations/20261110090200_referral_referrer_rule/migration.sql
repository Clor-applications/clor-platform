-- Referrals (A20): the company's rule for a referrer who leaves before the bonus date.
-- Default true: the bonus is not paid (serving notice counts as still here). Additive only.
ALTER TABLE "PeopleSetting" ADD COLUMN "referralForfeitIfReferrerLeaves" BOOLEAN NOT NULL DEFAULT true;

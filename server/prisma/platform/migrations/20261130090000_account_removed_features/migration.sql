-- Ops P1-5: features CLOR has turned off for one account.
ALTER TABLE "AccountEntitlement" ADD COLUMN "removedFeatures" TEXT NOT NULL DEFAULT '';

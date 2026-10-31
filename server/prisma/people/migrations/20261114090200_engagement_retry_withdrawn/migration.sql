-- A recipe that failed part way is run again on the next wake that day (services/people/engagement/automations.ts).
ALTER TABLE "AutomationRun" ADD COLUMN "retry" BOOLEAN NOT NULL DEFAULT false;

-- The leaving this exit interview belonged to was withdrawn: a later leaving does not take it over.
ALTER TABLE "ExitInterview" ADD COLUMN "withdrawnAt" TIMESTAMP(3);

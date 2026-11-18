-- Server picks theme B (leave approvals): close leave still waiting when its first day passes, off by default.
ALTER TABLE "PeopleSetting" ADD COLUMN IF NOT EXISTS "closePassedLeave" BOOLEAN NOT NULL DEFAULT false;

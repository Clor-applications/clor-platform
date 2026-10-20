-- SX-09: a company can require owners and admins to sign in with an authenticator.
ALTER TABLE "AuthPolicy" ADD COLUMN "requireAdminTwoFactor" BOOLEAN NOT NULL DEFAULT false;

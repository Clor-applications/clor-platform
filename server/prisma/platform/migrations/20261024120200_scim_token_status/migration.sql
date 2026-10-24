-- A-31: a revoked SCIM token is kept, not deleted.
ALTER TABLE "ScimToken" ADD COLUMN "revokedAt" TIMESTAMP(3);

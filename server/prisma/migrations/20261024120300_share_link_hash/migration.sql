-- A-32: a share link is found by its hash; an encrypted copy lets reminders send the same address.
ALTER TABLE "DocumentShareLink" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "DocumentShareLink" ADD COLUMN "tokenEnc" TEXT;
CREATE UNIQUE INDEX "DocumentShareLink_tokenHash_key" ON "DocumentShareLink"("tokenHash");

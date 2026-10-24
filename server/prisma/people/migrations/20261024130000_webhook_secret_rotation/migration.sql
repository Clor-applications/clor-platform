-- A-34: a webhook's secret can be changed; the old one is still signed with for a day so the receiver can switch.
ALTER TABLE "Webhook" ADD COLUMN "previousSecret" TEXT;
ALTER TABLE "Webhook" ADD COLUMN "previousSecretUntil" TIMESTAMP(3);

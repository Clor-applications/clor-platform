-- Each time the platform refused a signed-in person (402, or 403 with a reason code): who, which account and
-- company, the reason code, the app, the route shape and the request id. For CLOR staff's Entitlement denials page.
-- Platform data read only by CLOR operators; no account policy. Capped per minute and pruned after 30 days.
CREATE TABLE "EntitlementDenial" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "orgId" TEXT,
    "userId" TEXT,
    "code" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "app" TEXT,
    "feature" TEXT,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntitlementDenial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EntitlementDenial_createdAt_idx" ON "EntitlementDenial"("createdAt");
CREATE INDEX "EntitlementDenial_accountId_createdAt_idx" ON "EntitlementDenial"("accountId", "createdAt");
CREATE INDEX "EntitlementDenial_code_createdAt_idx" ON "EntitlementDenial"("code", "createdAt");
CREATE INDEX "EntitlementDenial_requestId_idx" ON "EntitlementDenial"("requestId");

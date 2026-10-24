-- A-33: employee portal sign-ins become server-side sessions, one per device.
ALTER TABLE "Employee" ADD COLUMN "portalSessionsRevokedAt" TIMESTAMP(3);

CREATE TABLE "PortalSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceLabel" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PortalSession_orgId_employeeId_revokedAt_idx" ON "PortalSession"("orgId", "employeeId", "revokedAt");

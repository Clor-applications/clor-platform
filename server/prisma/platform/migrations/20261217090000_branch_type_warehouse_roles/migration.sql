-- Books developer changes, 28 Oct and 8 Nov 2026. Additive.

-- What a branch does: SERVICE | TRADING | BOTH. Existing branches keep doing both.
ALTER TABLE "Branch" ADD COLUMN "branchType" TEXT NOT NULL DEFAULT 'BOTH';

-- A role a user holds at one warehouse, on top of their branch role.
CREATE TABLE "UserWarehouseRoleAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWarehouseRoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserWarehouseRoleAssignment_accountId_orgId_warehouseId_use_key" ON "UserWarehouseRoleAssignment"("accountId", "orgId", "warehouseId", "userId");
CREATE INDEX "UserWarehouseRoleAssignment_accountId_orgId_branchId_userId_idx" ON "UserWarehouseRoleAssignment"("accountId", "orgId", "branchId", "userId");

ALTER TABLE "UserWarehouseRoleAssignment" ADD CONSTRAINT "UserWarehouseRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserWarehouseRoleAssignment" ADD CONSTRAINT "UserWarehouseRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

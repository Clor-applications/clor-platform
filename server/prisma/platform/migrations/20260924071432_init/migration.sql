-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "legalName" TEXT,
    "pan" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "profileJson" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchCode" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "gstin" TEXT,
    "gstRegistrationType" TEXT NOT NULL DEFAULT 'UNREGISTERED',
    "phone" TEXT,
    "email" TEXT,
    "contactPerson" TEXT,
    "parentBranchId" TEXT,
    "shareHeadOfficeSettings" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOrgMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserOrgMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBranchMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBranchMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWarehouseAccess" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWarehouseAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "roleType" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "subModule" TEXT,
    "action" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "permLevel" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT,
    "metadata" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleProfileRole" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "RoleProfileRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoleProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "branchId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountEntitlement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "extraFeatures" TEXT NOT NULL DEFAULT '',
    "maxCompanies" INTEGER,
    "maxUsers" INTEGER,
    "validUntil" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureSetting" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "replacedBySessionId" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "userId" TEXT,
    "email" TEXT,
    "eventType" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSetting" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'SYSTEM',
    "host" TEXT,
    "port" INTEGER,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT,
    "passwordEnc" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "orgId" TEXT,
    "templateKey" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "toName" TEXT,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "relatedType" TEXT,
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "extraRecipients" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthPolicy" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "maxFailedLogins" INTEGER NOT NULL DEFAULT 8,
    "lockoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "sessionDays" INTEGER NOT NULL DEFAULT 30,
    "accessTokenMinutes" INTEGER NOT NULL DEFAULT 15,
    "passwordMinLength" INTEGER NOT NULL DEFAULT 8,
    "passwordRequireMixedCase" BOOLEAN NOT NULL DEFAULT false,
    "passwordRequireNumber" BOOLEAN NOT NULL DEFAULT false,
    "passwordRequireSymbol" BOOLEAN NOT NULL DEFAULT false,
    "requireVerifiedEmail" BOOLEAN NOT NULL DEFAULT false,
    "allowedEmailDomains" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthProvider" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuer" TEXT,
    "clientId" TEXT,
    "clientSecretEnc" TEXT,
    "discoveryUrl" TEXT,
    "scopes" TEXT DEFAULT 'openid email profile',
    "entryPoint" TEXT,
    "entityId" TEXT,
    "certificate" TEXT,
    "emailDomains" TEXT,
    "autoProvision" BOOLEAN NOT NULL DEFAULT false,
    "defaultRoleId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Org_slug_key" ON "Org"("slug");

-- CreateIndex
CREATE INDEX "Org_accountId_idx" ON "Org"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Org_accountId_name_key" ON "Org"("accountId", "name");

-- CreateIndex
CREATE INDEX "Branch_accountId_orgId_idx" ON "Branch"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_orgId_branchCode_key" ON "Branch"("orgId", "branchCode");

-- CreateIndex
CREATE INDEX "User_accountId_idx" ON "User"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserOrgMembership_accountId_orgId_idx" ON "UserOrgMembership"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "UserOrgMembership_accountId_orgId_userId_key" ON "UserOrgMembership"("accountId", "orgId", "userId");

-- CreateIndex
CREATE INDEX "UserBranchMembership_accountId_orgId_branchId_idx" ON "UserBranchMembership"("accountId", "orgId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBranchMembership_accountId_orgId_branchId_userId_key" ON "UserBranchMembership"("accountId", "orgId", "branchId", "userId");

-- CreateIndex
CREATE INDEX "UserWarehouseAccess_accountId_orgId_branchId_warehouseId_idx" ON "UserWarehouseAccess"("accountId", "orgId", "branchId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "UserWarehouseAccess_accountId_orgId_branchId_warehouseId_us_key" ON "UserWarehouseAccess"("accountId", "orgId", "branchId", "warehouseId", "userId");

-- CreateIndex
CREATE INDEX "Role_accountId_orgId_idx" ON "Role"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_orgId_branchId_name_key" ON "Role"("orgId", "branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_module_subModule_action_key" ON "Permission"("module", "subModule", "action");

-- CreateIndex
CREATE INDEX "RolePermission_accountId_orgId_idx" ON "RolePermission"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_accountId_orgId_branchId_idx" ON "UserRoleAssignment"("accountId", "orgId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_accountId_orgId_branchId_userId_roleId_key" ON "UserRoleAssignment"("accountId", "orgId", "branchId", "userId", "roleId");

-- CreateIndex
CREATE INDEX "AuditLog_accountId_orgId_branchId_idx" ON "AuditLog"("accountId", "orgId", "branchId");

-- CreateIndex
CREATE INDEX "RoleProfile_accountId_orgId_idx" ON "RoleProfile"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleProfile_orgId_name_key" ON "RoleProfile"("orgId", "name");

-- CreateIndex
CREATE INDEX "RoleProfileRole_accountId_orgId_idx" ON "RoleProfileRole"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleProfileRole_profileId_roleId_key" ON "RoleProfileRole"("profileId", "roleId");

-- CreateIndex
CREATE INDEX "UserRoleProfile_accountId_orgId_userId_idx" ON "UserRoleProfile"("accountId", "orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleProfile_accountId_orgId_userId_profileId_key" ON "UserRoleProfile"("accountId", "orgId", "userId", "profileId");

-- CreateIndex
CREATE INDEX "UserPermission_accountId_orgId_userId_entityType_idx" ON "UserPermission"("accountId", "orgId", "userId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_accountId_orgId_userId_entityType_entityId_key" ON "UserPermission"("accountId", "orgId", "userId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountEntitlement_accountId_key" ON "AccountEntitlement"("accountId");

-- CreateIndex
CREATE INDEX "AccountEntitlement_accountId_idx" ON "AccountEntitlement"("accountId");

-- CreateIndex
CREATE INDEX "FeatureSetting_accountId_orgId_idx" ON "FeatureSetting"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureSetting_orgId_key_key" ON "FeatureSetting"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_accountId_userId_revokedAt_idx" ON "Session"("accountId", "userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_usedAt_idx" ON "PasswordResetToken"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "AuthEvent_userId_createdAt_idx" ON "AuthEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_email_eventType_createdAt_idx" ON "AuthEvent"("email", "eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSetting_orgId_key" ON "EmailSetting"("orgId");

-- CreateIndex
CREATE INDEX "EmailSetting_accountId_orgId_idx" ON "EmailSetting"("accountId", "orgId");

-- CreateIndex
CREATE INDEX "EmailOutbox_accountId_orgId_status_idx" ON "EmailOutbox"("accountId", "orgId", "status");

-- CreateIndex
CREATE INDEX "EmailOutbox_templateKey_createdAt_idx" ON "EmailOutbox"("templateKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_usedAt_idx" ON "EmailVerificationToken"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "NotificationSetting_accountId_orgId_idx" ON "NotificationSetting"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_orgId_eventKey_key" ON "NotificationSetting"("orgId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "AuthPolicy_orgId_key" ON "AuthPolicy"("orgId");

-- CreateIndex
CREATE INDEX "AuthPolicy_accountId_orgId_idx" ON "AuthPolicy"("accountId", "orgId");

-- CreateIndex
CREATE INDEX "AuthProvider_accountId_orgId_enabled_idx" ON "AuthProvider"("accountId", "orgId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AuthProvider_orgId_name_key" ON "AuthProvider"("orgId", "name");

-- AddForeignKey
ALTER TABLE "Org" ADD CONSTRAINT "Org_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Org" ADD CONSTRAINT "Org_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_parentBranchId_fkey" FOREIGN KEY ("parentBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrgMembership" ADD CONSTRAINT "UserOrgMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrgMembership" ADD CONSTRAINT "UserOrgMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranchMembership" ADD CONSTRAINT "UserBranchMembership_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranchMembership" ADD CONSTRAINT "UserBranchMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWarehouseAccess" ADD CONSTRAINT "UserWarehouseAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleProfileRole" ADD CONSTRAINT "RoleProfileRole_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RoleProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleProfile" ADD CONSTRAINT "UserRoleProfile_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RoleProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntitlement" ADD CONSTRAINT "AccountEntitlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;


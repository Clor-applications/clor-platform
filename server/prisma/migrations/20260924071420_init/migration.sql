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
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "gstin" TEXT,
    "gstRegistrationType" TEXT NOT NULL DEFAULT 'UNREGISTERED',
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyOnHand" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterBranchTransfer" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sourceBranchId" TEXT NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "targetBranchId" TEXT NOT NULL,
    "targetWarehouseId" TEXT NOT NULL,
    "transferNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "initiatedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "rejectedReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterBranchTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterBranchTransferLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterBranchTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAdjustment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyDelta" DECIMAL(65,30) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dueDate" TEXT,
    "refNo" TEXT,
    "refDate" TEXT,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerGstin" TEXT,
    "placeOfSupplyState" TEXT,
    "taxType" TEXT,
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "extrasJson" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "igstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "sourceEstimateId" TEXT,
    "itemsJson" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "baseTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "irn" TEXT,
    "irnStatus" TEXT,
    "irnAckNo" TEXT,
    "irnAckDate" TEXT,
    "irnSignedQr" TEXT,
    "irnSignedInvoice" TEXT,
    "einvoicePayloadJson" TEXT,
    "irnError" TEXT,
    "irnRegisteredAt" TIMESTAMP(3),
    "irnCancelledAt" TIMESTAMP(3),
    "irnCancelReason" TEXT,
    "ewbNo" TEXT,
    "ewbDate" TEXT,
    "ewbValidTill" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dueDate" TEXT,
    "refNo" TEXT,
    "refDate" TEXT,
    "againstDocId" TEXT,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyGstin" TEXT,
    "placeOfSupplyState" TEXT,
    "taxType" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "igstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "settledAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "itemsJson" TEXT NOT NULL,
    "extrasJson" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "baseTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "validUntil" TEXT,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyGstin" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "itemsJson" TEXT NOT NULL,
    "extrasJson" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderDoc" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "expectedDate" TEXT,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyGstin" TEXT,
    "warehouseId" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "itemsJson" TEXT NOT NULL,
    "extrasJson" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderDoc" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "expectedDate" TEXT,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyGstin" TEXT,
    "warehouseId" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "itemsJson" TEXT NOT NULL,
    "extrasJson" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryChallan" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyGstin" TEXT,
    "warehouseId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'SUPPLY',
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "convertedInvoiceId" TEXT,
    "itemsJson" TEXT NOT NULL,
    "extrasJson" TEXT,
    "notes" TEXT,
    "ewayBillNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryChallan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "purchaseDate" TEXT NOT NULL,
    "cost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "salvageValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "depreciationMethod" TEXT NOT NULL DEFAULT 'SLM',
    "depreciationRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "usefulLifeYears" INTEGER,
    "accumulatedDepreciation" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "disposalDate" TEXT,
    "disposalValue" DECIMAL(65,30),
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salesman" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "commissionRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salesman_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dueDate" TEXT,
    "refNo" TEXT,
    "refDate" TEXT,
    "againstDocId" TEXT,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyGstin" TEXT,
    "placeOfSupplyState" TEXT,
    "taxType" TEXT,
    "category" TEXT,
    "description" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "igstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "settledAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Unpaid',
    "itemsJson" TEXT NOT NULL,
    "extrasJson" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "baseTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dueDate" TEXT,
    "refNo" TEXT,
    "refDate" TEXT,
    "againstDocId" TEXT,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyGstin" TEXT,
    "placeOfSupplyState" TEXT,
    "taxType" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "igstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "settledAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "itemsJson" TEXT NOT NULL,
    "extrasJson" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "baseTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebitNote" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dueDate" TEXT,
    "refNo" TEXT,
    "refDate" TEXT,
    "againstDocId" TEXT,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "partyGstin" TEXT,
    "placeOfSupplyState" TEXT,
    "taxType" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sgstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "igstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gstTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "settledAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "itemsJson" TEXT NOT NULL,
    "extrasJson" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "baseTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebitNote_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lockedThrough" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "parentId" TEXT,
    "controlKind" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "entryNo" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "narration" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "postedByUserId" TEXT,
    "reversedById" TEXT,
    "sourceDocType" TEXT,
    "sourceDocId" TEXT,
    "prevHash" TEXT,
    "hash" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "partyType" TEXT,
    "partyId" TEXT,
    "itemId" TEXT,
    "warehouseId" TEXT,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxCode" TEXT,
    "hsnSac" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "docType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "maxAmount" DECIMAL(65,30),
    "approverRoleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "blocksPosting" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "partyType" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "gstin" TEXT,
    "gstRegistrationType" TEXT NOT NULL DEFAULT 'UNREGISTERED',
    "pan" TEXT,
    "placeOfSupplyState" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "contactPerson" TEXT,
    "billingLine1" TEXT,
    "billingLine2" TEXT,
    "billingCity" TEXT,
    "billingState" TEXT,
    "billingPincode" TEXT,
    "billingCountry" TEXT DEFAULT 'India',
    "billingDistrict" TEXT,
    "shippingSameAsBilling" BOOLEAN NOT NULL DEFAULT true,
    "shippingLine1" TEXT,
    "shippingLine2" TEXT,
    "shippingCity" TEXT,
    "shippingState" TEXT,
    "shippingPincode" TEXT,
    "shippingCountry" TEXT,
    "shippingDistrict" TEXT,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 0,
    "paymentTermName" TEXT,
    "creditLimit" DECIMAL(65,30),
    "openingBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "openingBalanceType" TEXT NOT NULL DEFAULT 'DR',
    "partyGroup" TEXT,
    "currency" TEXT,
    "priceListId" TEXT,
    "msmeNumber" TEXT,
    "statutoryOther" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyAddress" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "country" TEXT DEFAULT 'India',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyContact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyContact_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "EInvoiceSetting" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SANDBOX',
    "provider" TEXT NOT NULL DEFAULT 'GSP',
    "baseUrl" TEXT,
    "gstin" TEXT,
    "publicKeyPem" TEXT,
    "username" TEXT,
    "passwordEnc" TEXT,
    "clientId" TEXT,
    "clientSecretEnc" TEXT,
    "headersJson" TEXT,
    "autoRegister" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EInvoiceSetting_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "ItemMaster" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "itemType" TEXT NOT NULL DEFAULT 'STOCK',
    "unit" TEXT NOT NULL DEFAULT 'Pcs',
    "hsnSac" TEXT,
    "gstRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "purchasePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "openingQty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "trackBy" TEXT NOT NULL DEFAULT 'NONE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "mfgDate" TEXT,
    "expiryDate" TEXT,
    "qtyOnHand" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialNumber" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT,
    "serialNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "issuedDocType" TEXT,
    "issuedDocId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "notes" TEXT,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerialNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'CSV',
    "fileName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "committedRows" INTEGER NOT NULL DEFAULT 0,
    "committedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sourceKey" TEXT,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT '',
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSeries" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "docType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "padding" INTEGER NOT NULL DEFAULT 4,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "resetPolicy" TEXT NOT NULL DEFAULT 'FISCAL_YEAR',
    "fiscalYear" TEXT,
    "periodKey" TEXT,
    "allowManual" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "partyType" TEXT,
    "partyId" TEXT,
    "partyName" TEXT,
    "ledgerAccountId" TEXT NOT NULL,
    "instrumentRef" TEXT,
    "instrumentDate" TEXT,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "bankDate" TIMESTAMP(3),
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "statementRef" TEXT,
    "sourceSystem" TEXT,
    "sourceKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTenderAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tender" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTenderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgMaster" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dataJson" TEXT NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentShareLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankBookEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "ledgerAccountId" TEXT NOT NULL,
    "contraLedgerAccountId" TEXT,
    "direction" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "narration" TEXT,
    "reference" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "linkedPaymentId" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "bankDate" TIMESTAMP(3),
    "statementRef" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosDayClose" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "date" TEXT NOT NULL,
    "invoices" INTEGER NOT NULL DEFAULT 0,
    "cash" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "upi" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "card" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "countedCash" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "overShort" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "denomJson" TEXT NOT NULL DEFAULT '{}',
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosDayClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringSchedule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "partyId" TEXT,
    "partyName" TEXT NOT NULL,
    "warehouseId" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "nextRunDate" TEXT NOT NULL,
    "endDate" TEXT,
    "maxOccurrences" INTEGER,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "dueDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "templateJson" TEXT NOT NULL,
    "notes" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringScheduleRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "periodDate" TEXT NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringScheduleRun_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "Warehouse_accountId_orgId_branchId_idx" ON "Warehouse"("accountId", "orgId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_orgId_branchId_name_key" ON "Warehouse"("orgId", "branchId", "name");

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
CREATE INDEX "Item_accountId_orgId_idx" ON "Item"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_orgId_branchId_sku_key" ON "Item"("orgId", "branchId", "sku");

-- CreateIndex
CREATE INDEX "StockBalance_accountId_orgId_branchId_warehouseId_idx" ON "StockBalance"("accountId", "orgId", "branchId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_orgId_branchId_warehouseId_itemId_key" ON "StockBalance"("orgId", "branchId", "warehouseId", "itemId");

-- CreateIndex
CREATE INDEX "InterBranchTransfer_accountId_orgId_sourceBranchId_idx" ON "InterBranchTransfer"("accountId", "orgId", "sourceBranchId");

-- CreateIndex
CREATE INDEX "InterBranchTransfer_accountId_orgId_targetBranchId_idx" ON "InterBranchTransfer"("accountId", "orgId", "targetBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "InterBranchTransfer_orgId_transferNo_key" ON "InterBranchTransfer"("orgId", "transferNo");

-- CreateIndex
CREATE INDEX "InterBranchTransferLine_accountId_orgId_transferId_idx" ON "InterBranchTransferLine"("accountId", "orgId", "transferId");

-- CreateIndex
CREATE INDEX "InventoryAdjustment_accountId_orgId_branchId_warehouseId_it_idx" ON "InventoryAdjustment"("accountId", "orgId", "branchId", "warehouseId", "itemId");

-- CreateIndex
CREATE INDEX "Invoice_accountId_orgId_branchId_date_idx" ON "Invoice"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orgId_number_key" ON "Invoice"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orgId_sourceSystem_sourceKey_key" ON "Invoice"("orgId", "sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "Bill_accountId_orgId_branchId_date_idx" ON "Bill"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_orgId_number_key" ON "Bill"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_orgId_sourceSystem_sourceKey_key" ON "Bill"("orgId", "sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "Estimate_accountId_orgId_branchId_date_idx" ON "Estimate"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_orgId_number_key" ON "Estimate"("orgId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderDoc_accountId_orgId_branchId_date_idx" ON "PurchaseOrderDoc"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderDoc_orgId_number_key" ON "PurchaseOrderDoc"("orgId", "number");

-- CreateIndex
CREATE INDEX "SalesOrderDoc_accountId_orgId_branchId_date_idx" ON "SalesOrderDoc"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderDoc_orgId_number_key" ON "SalesOrderDoc"("orgId", "number");

-- CreateIndex
CREATE INDEX "DeliveryChallan_accountId_orgId_branchId_date_idx" ON "DeliveryChallan"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryChallan_orgId_number_key" ON "DeliveryChallan"("orgId", "number");

-- CreateIndex
CREATE INDEX "FixedAsset_accountId_orgId_status_idx" ON "FixedAsset"("accountId", "orgId", "status");

-- CreateIndex
CREATE INDEX "Salesman_accountId_orgId_isActive_idx" ON "Salesman"("accountId", "orgId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Salesman_orgId_name_key" ON "Salesman"("orgId", "name");

-- CreateIndex
CREATE INDEX "Expense_accountId_orgId_branchId_date_idx" ON "Expense"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_orgId_number_key" ON "Expense"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_orgId_sourceSystem_sourceKey_key" ON "Expense"("orgId", "sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "CreditNote_accountId_orgId_branchId_date_idx" ON "CreditNote"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_orgId_number_key" ON "CreditNote"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_orgId_sourceSystem_sourceKey_key" ON "CreditNote"("orgId", "sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "DebitNote_accountId_orgId_branchId_date_idx" ON "DebitNote"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DebitNote_orgId_number_key" ON "DebitNote"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DebitNote_orgId_sourceSystem_sourceKey_key" ON "DebitNote"("orgId", "sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "AuditLog_accountId_orgId_branchId_idx" ON "AuditLog"("accountId", "orgId", "branchId");

-- CreateIndex
CREATE INDEX "FiscalYear_accountId_orgId_idx" ON "FiscalYear"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_orgId_name_key" ON "FiscalYear"("orgId", "name");

-- CreateIndex
CREATE INDEX "Journal_accountId_orgId_idx" ON "Journal"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_orgId_branchId_code_key" ON "Journal"("orgId", "branchId", "code");

-- CreateIndex
CREATE INDEX "LedgerAccount_accountId_orgId_controlKind_idx" ON "LedgerAccount"("accountId", "orgId", "controlKind");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_orgId_branchId_code_key" ON "LedgerAccount"("orgId", "branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_orgId_sourceSystem_sourceKey_key" ON "LedgerAccount"("orgId", "sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "JournalEntry_accountId_orgId_branchId_date_idx" ON "JournalEntry"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_accountId_orgId_sourceDocType_sourceDocId_idx" ON "JournalEntry"("accountId", "orgId", "sourceDocType", "sourceDocId");

-- CreateIndex
CREATE INDEX "JournalEntry_accountId_orgId_status_idx" ON "JournalEntry"("accountId", "orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_orgId_branchId_entryNo_key" ON "JournalEntry"("orgId", "branchId", "entryNo");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_orgId_branchId_ledgerAccountId_idx" ON "JournalLine"("accountId", "orgId", "branchId", "ledgerAccountId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_orgId_partyType_partyId_idx" ON "JournalLine"("accountId", "orgId", "partyType", "partyId");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

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
CREATE INDEX "ApprovalRule_accountId_orgId_docType_isActive_idx" ON "ApprovalRule"("accountId", "orgId", "docType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRule_orgId_docType_name_key" ON "ApprovalRule"("orgId", "docType", "name");

-- CreateIndex
CREATE INDEX "ApprovalRequest_accountId_orgId_docType_docId_idx" ON "ApprovalRequest"("accountId", "orgId", "docType", "docId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_accountId_orgId_status_idx" ON "ApprovalRequest"("accountId", "orgId", "status");

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
CREATE INDEX "Party_accountId_orgId_partyType_isActive_idx" ON "Party"("accountId", "orgId", "partyType", "isActive");

-- CreateIndex
CREATE INDEX "Party_accountId_orgId_gstin_idx" ON "Party"("accountId", "orgId", "gstin");

-- CreateIndex
CREATE UNIQUE INDEX "Party_orgId_partyType_name_key" ON "Party"("orgId", "partyType", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Party_orgId_sourceSystem_sourceKey_key" ON "Party"("orgId", "sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "PartyAddress_accountId_orgId_partyId_idx" ON "PartyAddress"("accountId", "orgId", "partyId");

-- CreateIndex
CREATE INDEX "PartyContact_accountId_orgId_partyId_idx" ON "PartyContact"("accountId", "orgId", "partyId");

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
CREATE UNIQUE INDEX "EInvoiceSetting_orgId_key" ON "EInvoiceSetting"("orgId");

-- CreateIndex
CREATE INDEX "EInvoiceSetting_accountId_orgId_idx" ON "EInvoiceSetting"("accountId", "orgId");

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

-- CreateIndex
CREATE INDEX "ItemMaster_accountId_orgId_isActive_idx" ON "ItemMaster"("accountId", "orgId", "isActive");

-- CreateIndex
CREATE INDEX "ItemMaster_accountId_orgId_hsnSac_idx" ON "ItemMaster"("accountId", "orgId", "hsnSac");

-- CreateIndex
CREATE UNIQUE INDEX "ItemMaster_orgId_name_unit_key" ON "ItemMaster"("orgId", "name", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "ItemMaster_orgId_sourceSystem_sourceKey_key" ON "ItemMaster"("orgId", "sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "Batch_accountId_orgId_branchId_warehouseId_itemId_idx" ON "Batch"("accountId", "orgId", "branchId", "warehouseId", "itemId");

-- CreateIndex
CREATE INDEX "Batch_accountId_orgId_expiryDate_idx" ON "Batch"("accountId", "orgId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_orgId_itemId_warehouseId_batchNo_key" ON "Batch"("orgId", "itemId", "warehouseId", "batchNo");

-- CreateIndex
CREATE INDEX "SerialNumber_accountId_orgId_branchId_warehouseId_status_idx" ON "SerialNumber"("accountId", "orgId", "branchId", "warehouseId", "status");

-- CreateIndex
CREATE INDEX "SerialNumber_accountId_orgId_itemId_status_idx" ON "SerialNumber"("accountId", "orgId", "itemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SerialNumber_orgId_itemId_serialNo_key" ON "SerialNumber"("orgId", "itemId", "serialNo");

-- CreateIndex
CREATE INDEX "ImportBatch_accountId_orgId_branchId_docType_status_idx" ON "ImportBatch"("accountId", "orgId", "branchId", "docType", "status");

-- CreateIndex
CREATE INDEX "ImportRow_accountId_orgId_batchId_status_idx" ON "ImportRow"("accountId", "orgId", "batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_rowNumber_key" ON "ImportRow"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "Currency_accountId_orgId_isActive_idx" ON "Currency"("accountId", "orgId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Currency_orgId_code_key" ON "Currency"("orgId", "code");

-- CreateIndex
CREATE INDEX "ExchangeRate_accountId_orgId_code_date_idx" ON "ExchangeRate"("accountId", "orgId", "code", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_orgId_code_date_key" ON "ExchangeRate"("orgId", "code", "date");

-- CreateIndex
CREATE INDEX "NumberSeries_accountId_orgId_docType_isActive_idx" ON "NumberSeries"("accountId", "orgId", "docType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSeries_orgId_branchId_docType_name_key" ON "NumberSeries"("orgId", "branchId", "docType", "name");

-- CreateIndex
CREATE INDEX "Payment_accountId_orgId_branchId_date_idx" ON "Payment"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE INDEX "Payment_accountId_orgId_reconciled_idx" ON "Payment"("accountId", "orgId", "reconciled");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orgId_number_key" ON "Payment"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orgId_sourceSystem_sourceKey_key" ON "Payment"("orgId", "sourceSystem", "sourceKey");

-- CreateIndex
CREATE INDEX "PosTenderAccount_accountId_orgId_branchId_idx" ON "PosTenderAccount"("accountId", "orgId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PosTenderAccount_orgId_branchId_tender_key" ON "PosTenderAccount"("orgId", "branchId", "tender");

-- CreateIndex
CREATE INDEX "PaymentAllocation_accountId_orgId_docType_docId_idx" ON "PaymentAllocation"("accountId", "orgId", "docType", "docId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "OrgMaster_accountId_orgId_kind_idx" ON "OrgMaster"("accountId", "orgId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMaster_accountId_orgId_kind_name_key" ON "OrgMaster"("accountId", "orgId", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentShareLink_token_key" ON "DocumentShareLink"("token");

-- CreateIndex
CREATE INDEX "DocumentShareLink_accountId_orgId_idx" ON "DocumentShareLink"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentShareLink_accountId_orgId_docType_docId_key" ON "DocumentShareLink"("accountId", "orgId", "docType", "docId");

-- CreateIndex
CREATE INDEX "BankBookEntry_accountId_orgId_ledgerAccountId_idx" ON "BankBookEntry"("accountId", "orgId", "ledgerAccountId");

-- CreateIndex
CREATE INDEX "BankBookEntry_accountId_orgId_reconciled_idx" ON "BankBookEntry"("accountId", "orgId", "reconciled");

-- CreateIndex
CREATE INDEX "PosDayClose_accountId_orgId_date_idx" ON "PosDayClose"("accountId", "orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PosDayClose_accountId_orgId_branchId_date_key" ON "PosDayClose"("accountId", "orgId", "branchId", "date");

-- CreateIndex
CREATE INDEX "RecurringSchedule_accountId_orgId_isActive_idx" ON "RecurringSchedule"("accountId", "orgId", "isActive");

-- CreateIndex
CREATE INDEX "RecurringSchedule_nextRunDate_idx" ON "RecurringSchedule"("nextRunDate");

-- CreateIndex
CREATE INDEX "RecurringScheduleRun_accountId_orgId_idx" ON "RecurringScheduleRun"("accountId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringScheduleRun_scheduleId_periodDate_key" ON "RecurringScheduleRun"("scheduleId", "periodDate");

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
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "UserWarehouseAccess" ADD CONSTRAINT "UserWarehouseAccess_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterBranchTransfer" ADD CONSTRAINT "InterBranchTransfer_sourceBranchId_fkey" FOREIGN KEY ("sourceBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterBranchTransfer" ADD CONSTRAINT "InterBranchTransfer_targetBranchId_fkey" FOREIGN KEY ("targetBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterBranchTransfer" ADD CONSTRAINT "InterBranchTransfer_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterBranchTransfer" ADD CONSTRAINT "InterBranchTransfer_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterBranchTransferLine" ADD CONSTRAINT "InterBranchTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "InterBranchTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterBranchTransferLine" ADD CONSTRAINT "InterBranchTransferLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterBranchTransferLine" ADD CONSTRAINT "InterBranchTransferLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleProfileRole" ADD CONSTRAINT "RoleProfileRole_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RoleProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleProfile" ADD CONSTRAINT "UserRoleProfile_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RoleProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ApprovalRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountEntitlement" ADD CONSTRAINT "AccountEntitlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAddress" ADD CONSTRAINT "PartyAddress_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyContact" ADD CONSTRAINT "PartyContact_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialNumber" ADD CONSTRAINT "SerialNumber_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTenderAccount" ADD CONSTRAINT "PosTenderAccount_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMaster" ADD CONSTRAINT "OrgMaster_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMaster" ADD CONSTRAINT "OrgMaster_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentShareLink" ADD CONSTRAINT "DocumentShareLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankBookEntry" ADD CONSTRAINT "BankBookEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosDayClose" ADD CONSTRAINT "PosDayClose_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringScheduleRun" ADD CONSTRAINT "RecurringScheduleRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RecurringSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

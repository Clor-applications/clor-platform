-- Custom fields on a person (docs/people/02-PRD.md CORE-08): typed, with who may
-- see and who may edit, versioned on every change to the definition.
CREATE TABLE "CustomFieldDef" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT 'Employee',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "viewPermission" TEXT NOT NULL,
    "editPermission" TEXT NOT NULL,
    "help" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomFieldDef_orgId_entity_key_key" ON "CustomFieldDef"("orgId", "entity", "key");

CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "defId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "value" JSONB,
    "defVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomFieldValue_defId_entityId_key" ON "CustomFieldValue"("defId", "entityId");
CREATE INDEX "CustomFieldValue_orgId_entityId_idx" ON "CustomFieldValue"("orgId", "entityId");
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_defId_fkey" FOREIGN KEY ("defId") REFERENCES "CustomFieldDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

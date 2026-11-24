-- AlterTable
ALTER TABLE "client_accounts" ADD COLUMN     "defaultInvestigationTypeId" TEXT,
ADD COLUMN     "defaultProductId" TEXT,
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "templateFields" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "clientAccountId" TEXT;

-- AlterTable
ALTER TABLE "investigations" ADD COLUMN     "clientAccountId" TEXT;

-- CreateIndex
CREATE INDEX "import_batches_tenantId_clientAccountId_idx" ON "import_batches"("tenantId", "clientAccountId");

-- CreateIndex
CREATE INDEX "investigations_tenantId_clientAccountId_idx" ON "investigations"("tenantId", "clientAccountId");

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "client_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "client_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_defaultProductId_fkey" FOREIGN KEY ("defaultProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_defaultInvestigationTypeId_fkey" FOREIGN KEY ("defaultInvestigationTypeId") REFERENCES "investigation_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Clients ("الجهات"): the permissions existed as portal groundwork; they now
-- govern the banks and companies, their logo and their inquiry template, which
-- replace the separate import screen. Viewing goes to whoever can already view
-- imports, managing to whoever can already manage import mappings — the
-- closest existing measures — so no role name appears here.
UPDATE "permissions" SET "labelAr" = 'عرض الجهات', "labelEn" = 'View clients'
WHERE "code" = 'clients.view';
UPDATE "permissions" SET "labelAr" = 'إدارة الجهات وقوالبها', "labelEn" = 'Manage clients and their templates'
WHERE "code" = 'clients.manage';

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "roleId", 'clients.view' FROM "role_permissions"
WHERE "permissionCode" = 'imports.view'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "roleId", 'clients.manage' FROM "role_permissions"
WHERE "permissionCode" = 'imports.manage_mappings'
ON CONFLICT DO NOTHING;

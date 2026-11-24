-- A client's single default product / inquiry type becomes a list of the ones
-- its cases may have (empty = all). A client that had a default keeps it, as a
-- one-item list — which still acts as the default for rows without a column.
ALTER TABLE "client_accounts"
ADD COLUMN     "investigationTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "client_accounts" SET "productIds" = ARRAY["defaultProductId"]
WHERE "defaultProductId" IS NOT NULL;
UPDATE "client_accounts" SET "investigationTypeIds" = ARRAY["defaultInvestigationTypeId"]
WHERE "defaultInvestigationTypeId" IS NOT NULL;

ALTER TABLE "client_accounts" DROP CONSTRAINT "client_accounts_defaultInvestigationTypeId_fkey";
ALTER TABLE "client_accounts" DROP CONSTRAINT "client_accounts_defaultProductId_fkey";
ALTER TABLE "client_accounts" DROP COLUMN "defaultInvestigationTypeId",
DROP COLUMN "defaultProductId";

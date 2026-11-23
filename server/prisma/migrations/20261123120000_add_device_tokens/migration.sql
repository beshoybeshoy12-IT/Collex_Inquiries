-- DeviceToken was added to schema.prisma without a migration, so
-- `migrate deploy` never created the table. This is that migration.

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "principalType" "PrincipalType" NOT NULL,
    "userId" TEXT,
    "investigatorId" TEXT,
    "token" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "appVersion" TEXT,
    "deviceModel" TEXT,
    "osVersion" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_tenantId_userId_idx" ON "device_tokens"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "device_tokens_tenantId_investigatorId_idx" ON "device_tokens"("tenantId", "investigatorId");

-- CreateIndex
CREATE INDEX "device_tokens_tenantId_disabledAt_idx" ON "device_tokens"("tenantId", "disabledAt");

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_investigatorId_fkey" FOREIGN KEY ("investigatorId") REFERENCES "investigators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

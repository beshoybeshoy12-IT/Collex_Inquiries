-- Office attendance (check-in / check-out with idle time) and company announcements.

-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'URGENT');

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "idleSeconds" INTEGER NOT NULL DEFAULT 0,
    "idlePeriods" INTEGER NOT NULL DEFAULT 0,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "audienceRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sessions_tenantId_workDate_idx" ON "attendance_sessions"("tenantId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_sessions_tenantId_userId_checkInAt_idx" ON "attendance_sessions"("tenantId", "userId", "checkInAt");

-- CreateIndex
CREATE INDEX "announcements_tenantId_deletedAt_createdAt_idx" ON "announcements"("tenantId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "announcement_reads_tenantId_userId_idx" ON "announcement_reads"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_reads_announcementId_userId_key" ON "announcement_reads"("announcementId", "userId");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one OPEN session per user. Prisma cannot express a partial unique
-- index, so it lives here; the service also checks, but two check-in clicks
-- racing each other are stopped by the database, not by the check.
CREATE UNIQUE INDEX "attendance_sessions_one_open_per_user"
  ON "attendance_sessions"("userId") WHERE "checkOutAt" IS NULL;

-- New permissions. The seeder mirrors the catalogue too; this makes an
-- existing database right without re-seeding.
INSERT INTO "permissions" ("code", "category", "labelAr", "labelEn", "sortOrder")
VALUES
  ('attendance.view_all', 'attendance', 'عرض حضور الموظفين', 'View staff attendance', 900),
  ('announcements.manage', 'announcements', 'إدارة الإعلانات', 'Manage announcements', 901)
ON CONFLICT ("code") DO NOTHING;

-- Granted to the roles that already hold the nearest existing grant, so no
-- role name is written into the migration: seeing everyone's attendance sits
-- with seeing their activity, and announcing sits with broadcasting.
INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "roleId", 'attendance.view_all' FROM "role_permissions"
WHERE "permissionCode" = 'users.view_activity'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionCode")
SELECT "roleId", 'announcements.manage' FROM "role_permissions"
WHERE "permissionCode" = 'notifications.broadcast'
ON CONFLICT DO NOTHING;

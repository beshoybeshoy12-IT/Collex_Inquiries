-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'TRIAL');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING', 'LOCKED');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('WEB_USER', 'INVESTIGATOR');

-- CreateEnum
CREATE TYPE "InvestigatorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'IN_TRAINING');

-- CreateEnum
CREATE TYPE "InvestigatorAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'AVAILABLE', 'BUSY', 'ON_VISIT', 'EN_ROUTE', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "EscalationTrigger" AS ENUM ('NOT_ACCEPTED', 'NOT_STARTED', 'SLA_WARNING', 'SLA_BREACH', 'QC_PENDING_TOO_LONG', 'REWORK_OVERDUE');

-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('NEW', 'VALIDATING', 'READY_FOR_ASSIGNMENT', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'SUBMITTED', 'AUTO_VALIDATION', 'QC_PENDING', 'QC_APPROVED', 'QC_REJECTED', 'REWORK', 'REPORT_GENERATION', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SlaState" AS ENUM ('GREEN', 'YELLOW', 'RED', 'MET', 'BREACHED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "InvestigationSource" AS ENUM ('EXCEL_IMPORT', 'API', 'MANUAL', 'CLIENT_PORTAL');

-- CreateEnum
CREATE TYPE "InvestigationResult" AS ENUM ('POSITIVE', 'NEGATIVE', 'PARTIAL', 'NOT_FOUND', 'REFUSED', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'REASSIGNED', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AssignmentMethod" AS ENUM ('MANUAL', 'BULK', 'AUTO', 'REASSIGN');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'PARSING', 'PREVIEW_READY', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'IMPORTED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('PHOTO', 'DOCUMENT', 'AUDIO', 'VIDEO', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'SCANNING', 'CLEAN', 'INFECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GpsEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'PHOTO_CAPTURE', 'LOCATION_UPDATE', 'ROUTE_START', 'ROUTE_END');

-- CreateEnum
CREATE TYPE "QcDecision" AS ENUM ('APPROVED', 'REJECTED', 'REWORK');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('QUEUED', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportLocale" AS ENUM ('AR', 'EN', 'BILINGUAL');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('XLSX', 'CSV', 'PDF');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CASE_CREATED', 'CASE_IMPORTED', 'CASE_ASSIGNED', 'CASE_REASSIGNED', 'CASE_ACCEPTED', 'CASE_REJECTED_BY_INVESTIGATOR', 'CASE_SUBMITTED', 'QC_APPROVED', 'QC_REJECTED', 'REWORK_REQUESTED', 'SLA_WARNING', 'SLA_BREACH', 'ESCALATION', 'REPORT_READY', 'EXPORT_READY', 'IMPORT_COMPLETED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH', 'SMS');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('AUTH', 'USER', 'ROLE', 'INVESTIGATOR', 'CUSTOMER', 'INVESTIGATION', 'ASSIGNMENT', 'IMPORT', 'FORM', 'MEDIA', 'QC', 'REPORT', 'EXPORT', 'SETTINGS', 'TENANT', 'SECURITY');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'NOTICE', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "taxId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine" TEXT,
    "defaultLocale" TEXT NOT NULL DEFAULT 'ar',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "subscriptionStart" TIMESTAMP(3),
    "subscriptionEnd" TIMESTAMP(3),
    "maxWebUsers" INTEGER NOT NULL DEFAULT 50,
    "maxInvestigators" INTEGER NOT NULL DEFAULT 200,
    "featureFlags" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "employeeCode" TEXT,
    "avatarUrl" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "roleId" TEXT,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "branch" TEXT,
    "department" TEXT,
    "allowedGovernorateIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEnc" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigators" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nationalId" TEXT,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "status" "InvestigatorStatus" NOT NULL DEFAULT 'IN_TRAINING',
    "availability" "InvestigatorAvailability" NOT NULL DEFAULT 'OFFLINE',
    "governorateIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "districtIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "areaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "investigationTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxDailyCases" INTEGER NOT NULL DEFAULT 15,
    "maxOpenCases" INTEGER NOT NULL DEFAULT 30,
    "qualityScore" DECIMAL(5,2),
    "avgTatMinutes" INTEGER,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "slaBreachCount" INTEGER NOT NULL DEFAULT 0,
    "trainingCompletedAt" TIMESTAMP(3),
    "contractEndsAt" TIMESTAMP(3),
    "lastLat" DECIMAL(10,7),
    "lastLng" DECIMAL(10,7),
    "lastLocationAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "deviceId" TEXT,
    "deviceModel" TEXT,
    "devicePlatform" TEXT,
    "pushToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "investigators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigator_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigatorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigator_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "principalType" "PrincipalType" NOT NULL,
    "userId" TEXT,
    "investigatorId" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "familyId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "device" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revoked_tokens" (
    "jti" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revoked_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "descriptionAr" TEXT,
    "descriptionEn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionCode")
);

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "userId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("userId","permissionCode")
);

-- CreateTable
CREATE TABLE "governorates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,

    CONSTRAINT "governorates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "governorateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultSlaHours" INTEGER NOT NULL DEFAULT 48,
    "defaultPriority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "price" DECIMAL(14,2),
    "requiredFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reportTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "colorHex" TEXT,
    "icon" TEXT,
    "defaultSlaHours" INTEGER NOT NULL DEFAULT 48,
    "formTemplateId" TEXT,
    "reportTemplateId" TEXT,
    "requiredPhotoCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investigation_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_investigation_types" (
    "productId" TEXT NOT NULL,
    "investigationTypeId" TEXT NOT NULL,
    "slaHours" INTEGER,
    "price" DECIMAL(14,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_investigation_types_pkey" PRIMARY KEY ("productId","investigationTypeId")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "productId" TEXT,
    "investigationTypeId" TEXT,
    "priority" "Priority",
    "totalHours" INTEGER NOT NULL,
    "assignmentHours" INTEGER NOT NULL DEFAULT 4,
    "acceptanceHours" INTEGER NOT NULL DEFAULT 2,
    "fieldHours" INTEGER NOT NULL DEFAULT 24,
    "qcHours" INTEGER NOT NULL DEFAULT 12,
    "warnAtPercent" INTEGER NOT NULL DEFAULT 80,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT false,
    "workdayStartHour" INTEGER NOT NULL DEFAULT 9,
    "workdayEndHour" INTEGER NOT NULL DEFAULT 17,
    "workdays" INTEGER[] DEFAULT ARRAY[7, 1, 2, 3, 4]::INTEGER[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "trigger" "EscalationTrigger" NOT NULL,
    "thresholdMinutes" INTEGER NOT NULL,
    "repeatEveryMinutes" INTEGER,
    "notifyRoleCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notifyCoordinator" BOOLEAN NOT NULL DEFAULT true,
    "notifyInvestigator" BOOLEAN NOT NULL DEFAULT false,
    "priority" "Priority",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_events" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "occurrence" INTEGER NOT NULL DEFAULT 0,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nationalId" TEXT,
    "mobile" TEXT,
    "altMobile" TEXT,
    "homePhone" TEXT,
    "email" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "residenceAddress" TEXT,
    "governorateId" TEXT,
    "cityId" TEXT,
    "districtId" TEXT,
    "areaId" TEXT,
    "residenceLat" DECIMAL(10,7),
    "residenceLng" DECIMAL(10,7),
    "workplaceName" TEXT,
    "workplacePhone" TEXT,
    "workplaceAddress" TEXT,
    "jobTitle" TEXT,
    "additionalData" JSONB,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "applicationNumber" TEXT,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "investigationTypeId" TEXT NOT NULL,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "source" "InvestigationSource" NOT NULL DEFAULT 'MANUAL',
    "result" "InvestigationResult",
    "addressLine" TEXT,
    "governorateId" TEXT,
    "cityId" TEXT,
    "districtId" TEXT,
    "areaId" TEXT,
    "targetLat" DECIMAL(10,7),
    "targetLng" DECIMAL(10,7),
    "coordinatorId" TEXT,
    "investigatorId" TEXT,
    "slaPolicyId" TEXT,
    "dueAt" TIMESTAMP(3),
    "formVersionId" TEXT,
    "importBatchId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "onSiteAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "qcAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "reworkCount" INTEGER NOT NULL DEFAULT 0,
    "cancelReason" TEXT,
    "notes" TEXT,
    "additionalData" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "investigations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_status_history" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "fromStatus" "InvestigationStatus",
    "toStatus" "InvestigationStatus" NOT NULL,
    "actorType" "PrincipalType",
    "actorId" TEXT,
    "actorName" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_comments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "authorType" "PrincipalType" NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "investigatorId" TEXT NOT NULL,
    "assignedById" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "AssignmentMethod" NOT NULL DEFAULT 'MANUAL',
    "previousAssignmentId" TEXT,
    "reassignReason" TEXT,
    "rejectReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publishedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "schema" JSONB NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "autoValidation" JSONB,
    "submittedByType" "PrincipalType",
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "clientSubmissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "fileSize" INTEGER,
    "sheetName" TEXT,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "mappingTemplateId" TEXT,
    "mappingUsed" JSONB,
    "defaultProductId" TEXT,
    "defaultInvestigationTypeId" TEXT,
    "defaultPriority" "Priority",
    "defaultDueAt" TIMESTAMP(3),
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "errorReportKey" TEXT,
    "errorSummary" JSONB,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parsedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'VALID',
    "rawData" JSONB NOT NULL,
    "mappedData" JSONB NOT NULL,
    "errors" JSONB,
    "warnings" JSONB,
    "duplicateOf" JSONB,
    "resolution" TEXT,
    "createdInvestigationId" TEXT,
    "createdCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mapping_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "mapping" JSONB NOT NULL,
    "defaults" JSONB,
    "duplicateRuleCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_mapping_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL DEFAULT 'PHOTO',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "minCount" INTEGER NOT NULL DEFAULT 0,
    "maxCount" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT,
    "customerId" TEXT,
    "categoryId" TEXT,
    "mediaType" "MediaType" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "storageKey" TEXT NOT NULL,
    "bucket" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" INTEGER,
    "capturedAt" TIMESTAMP(3),
    "captureLat" DECIMAL(10,7),
    "captureLng" DECIMAL(10,7),
    "captureAccuracy" DECIMAL(8,2),
    "uploadedByType" "PrincipalType",
    "uploadedById" TEXT,
    "caption" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT,
    "investigatorId" TEXT,
    "eventType" "GpsEventType" NOT NULL,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "accuracyM" DECIMAL(8,2),
    "altitudeM" DECIMAL(8,2),
    "speedMps" DECIMAL(8,2),
    "headingDeg" DECIMAL(6,2),
    "distanceFromTargetM" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "gps_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_rejection_reasons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "needsNote" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_rejection_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "submissionId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "reviewerId" TEXT,
    "decision" "QcDecision" NOT NULL,
    "comment" TEXT,
    "fieldRemarks" JSONB,
    "score" INTEGER,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_review_reasons" (
    "reviewId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "qc_review_reasons_pkey" PRIMARY KEY ("reviewId","reasonId")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "headerHtml" TEXT,
    "footerHtml" TEXT,
    "css" TEXT,
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "showQrCode" BOOLEAN NOT NULL DEFAULT true,
    "showWatermark" BOOLEAN NOT NULL DEFAULT false,
    "watermarkText" TEXT,
    "disclaimerAr" TEXT,
    "disclaimerEn" TEXT,
    "pageSize" TEXT NOT NULL DEFAULT 'A4',
    "marginsMm" JSONB NOT NULL DEFAULT '{"top":18,"right":14,"bottom":18,"left":14}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "templateId" TEXT,
    "version" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'QUEUED',
    "locale" "ReportLocale" NOT NULL DEFAULT 'AR',
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "pageCount" INTEGER,
    "snapshot" JSONB,
    "error" TEXT,
    "jobId" TEXT,
    "requestedById" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "filters" JSONB,
    "columns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rowCount" INTEGER,
    "storageKey" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "error" TEXT,
    "requestedById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipientType" "PrincipalType" NOT NULL,
    "userId" TEXT,
    "investigatorId" TEXT,
    "type" "NotificationType" NOT NULL,
    "channels" "NotificationChannel"[] DEFAULT ARRAY['IN_APP']::"NotificationChannel"[],
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "link" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveryStatus" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "actorType" "PrincipalType",
    "actorId" TEXT,
    "actorName" TEXT,
    "userId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "device" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "apiKeyHash" TEXT,
    "apiKeyPrefix" TEXT,
    "webhookUrl" TEXT,
    "webhookSecretEnc" TEXT,
    "portalUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_locks" (
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_locks_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "users_tenantId_status_idx" ON "users"("tenantId", "status");

-- CreateIndex
CREATE INDEX "users_tenantId_roleId_idx" ON "users"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "investigators_tenantId_status_idx" ON "investigators"("tenantId", "status");

-- CreateIndex
CREATE INDEX "investigators_tenantId_availability_idx" ON "investigators"("tenantId", "availability");

-- CreateIndex
CREATE INDEX "investigators_tenantId_phone_idx" ON "investigators"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "investigators_tenantId_employeeCode_key" ON "investigators"("tenantId", "employeeCode");

-- CreateIndex
CREATE INDEX "investigator_documents_tenantId_investigatorId_idx" ON "investigator_documents"("tenantId", "investigatorId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_tenantId_userId_idx" ON "sessions"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "sessions_tenantId_investigatorId_idx" ON "sessions"("tenantId", "investigatorId");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "revoked_tokens_expiresAt_idx" ON "revoked_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "permissions_category_idx" ON "permissions"("category");

-- CreateIndex
CREATE INDEX "roles_tenantId_idx" ON "roles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_code_key" ON "roles"("tenantId", "code");

-- CreateIndex
CREATE INDEX "role_permissions_permissionCode_idx" ON "role_permissions"("permissionCode");

-- CreateIndex
CREATE UNIQUE INDEX "governorates_code_key" ON "governorates"("code");

-- CreateIndex
CREATE INDEX "cities_governorateId_idx" ON "cities"("governorateId");

-- CreateIndex
CREATE UNIQUE INDEX "cities_governorateId_code_key" ON "cities"("governorateId", "code");

-- CreateIndex
CREATE INDEX "districts_cityId_idx" ON "districts"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "districts_cityId_code_key" ON "districts"("cityId", "code");

-- CreateIndex
CREATE INDEX "areas_districtId_idx" ON "areas"("districtId");

-- CreateIndex
CREATE UNIQUE INDEX "areas_districtId_code_key" ON "areas"("districtId", "code");

-- CreateIndex
CREATE INDEX "products_tenantId_isActive_idx" ON "products"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_code_key" ON "products"("tenantId", "code");

-- CreateIndex
CREATE INDEX "investigation_types_tenantId_isActive_idx" ON "investigation_types"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_types_tenantId_code_key" ON "investigation_types"("tenantId", "code");

-- CreateIndex
CREATE INDEX "product_investigation_types_investigationTypeId_idx" ON "product_investigation_types"("investigationTypeId");

-- CreateIndex
CREATE INDEX "sla_policies_tenantId_isActive_idx" ON "sla_policies"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_tenantId_code_key" ON "sla_policies"("tenantId", "code");

-- CreateIndex
CREATE INDEX "escalation_rules_tenantId_isActive_idx" ON "escalation_rules"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_rules_tenantId_code_key" ON "escalation_rules"("tenantId", "code");

-- CreateIndex
CREATE INDEX "escalation_events_tenantId_investigationId_idx" ON "escalation_events"("tenantId", "investigationId");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_events_ruleId_investigationId_occurrence_key" ON "escalation_events"("ruleId", "investigationId", "occurrence");

-- CreateIndex
CREATE INDEX "customers_tenantId_mobile_idx" ON "customers"("tenantId", "mobile");

-- CreateIndex
CREATE INDEX "customers_tenantId_fullName_idx" ON "customers"("tenantId", "fullName");

-- CreateIndex
CREATE INDEX "customers_tenantId_governorateId_idx" ON "customers"("tenantId", "governorateId");

-- CreateIndex
CREATE INDEX "customers_tenantId_createdAt_idx" ON "customers"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "customers_fullName_idx" ON "customers" USING GIN ("fullName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_mobile_idx" ON "customers" USING GIN ("mobile" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_nationalId_idx" ON "customers" USING GIN ("nationalId" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_nationalId_key" ON "customers"("tenantId", "nationalId");

-- CreateIndex
CREATE INDEX "investigations_tenantId_status_idx" ON "investigations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "investigations_tenantId_investigatorId_status_idx" ON "investigations"("tenantId", "investigatorId", "status");

-- CreateIndex
CREATE INDEX "investigations_tenantId_coordinatorId_idx" ON "investigations"("tenantId", "coordinatorId");

-- CreateIndex
CREATE INDEX "investigations_tenantId_customerId_idx" ON "investigations"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "investigations_tenantId_productId_idx" ON "investigations"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "investigations_tenantId_investigationTypeId_idx" ON "investigations"("tenantId", "investigationTypeId");

-- CreateIndex
CREATE INDEX "investigations_tenantId_governorateId_idx" ON "investigations"("tenantId", "governorateId");

-- CreateIndex
CREATE INDEX "investigations_tenantId_createdAt_idx" ON "investigations"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "investigations_tenantId_dueAt_idx" ON "investigations"("tenantId", "dueAt");

-- CreateIndex
CREATE INDEX "investigations_tenantId_applicationNumber_idx" ON "investigations"("tenantId", "applicationNumber");

-- CreateIndex
CREATE INDEX "investigations_tenantId_importBatchId_idx" ON "investigations"("tenantId", "importBatchId");

-- CreateIndex
CREATE INDEX "investigations_caseNumber_idx" ON "investigations" USING GIN ("caseNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "investigations_applicationNumber_idx" ON "investigations" USING GIN ("applicationNumber" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "investigations_tenantId_caseNumber_key" ON "investigations"("tenantId", "caseNumber");

-- CreateIndex
CREATE INDEX "investigation_status_history_tenantId_investigationId_creat_idx" ON "investigation_status_history"("tenantId", "investigationId", "createdAt");

-- CreateIndex
CREATE INDEX "investigation_comments_tenantId_investigationId_createdAt_idx" ON "investigation_comments"("tenantId", "investigationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_previousAssignmentId_key" ON "assignments"("previousAssignmentId");

-- CreateIndex
CREATE INDEX "assignments_tenantId_investigationId_assignedAt_idx" ON "assignments"("tenantId", "investigationId", "assignedAt");

-- CreateIndex
CREATE INDEX "assignments_tenantId_investigatorId_status_idx" ON "assignments"("tenantId", "investigatorId", "status");

-- CreateIndex
CREATE INDEX "assignments_tenantId_status_expiresAt_idx" ON "assignments"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "form_templates_publishedVersionId_key" ON "form_templates"("publishedVersionId");

-- CreateIndex
CREATE INDEX "form_templates_tenantId_isActive_idx" ON "form_templates"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "form_templates_tenantId_code_key" ON "form_templates"("tenantId", "code");

-- CreateIndex
CREATE INDEX "form_versions_tenantId_templateId_idx" ON "form_versions"("tenantId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "form_versions_templateId_version_key" ON "form_versions"("templateId", "version");

-- CreateIndex
CREATE INDEX "form_submissions_tenantId_investigationId_idx" ON "form_submissions"("tenantId", "investigationId");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_investigationId_attempt_key" ON "form_submissions"("investigationId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_tenantId_clientSubmissionId_key" ON "form_submissions"("tenantId", "clientSubmissionId");

-- CreateIndex
CREATE INDEX "import_batches_tenantId_status_idx" ON "import_batches"("tenantId", "status");

-- CreateIndex
CREATE INDEX "import_batches_tenantId_uploadedAt_idx" ON "import_batches"("tenantId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_tenantId_reference_key" ON "import_batches"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "import_rows_tenantId_batchId_status_idx" ON "import_rows"("tenantId", "batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batchId_rowNumber_key" ON "import_rows"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "import_mapping_templates_tenantId_isActive_idx" ON "import_mapping_templates"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_templates_tenantId_code_key" ON "import_mapping_templates"("tenantId", "code");

-- CreateIndex
CREATE INDEX "media_categories_tenantId_isActive_idx" ON "media_categories"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "media_categories_tenantId_code_key" ON "media_categories"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");

-- CreateIndex
CREATE INDEX "media_assets_tenantId_investigationId_idx" ON "media_assets"("tenantId", "investigationId");

-- CreateIndex
CREATE INDEX "media_assets_tenantId_customerId_idx" ON "media_assets"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "media_assets_tenantId_mediaType_idx" ON "media_assets"("tenantId", "mediaType");

-- CreateIndex
CREATE INDEX "media_assets_tenantId_status_idx" ON "media_assets"("tenantId", "status");

-- CreateIndex
CREATE INDEX "gps_events_tenantId_investigationId_recordedAt_idx" ON "gps_events"("tenantId", "investigationId", "recordedAt");

-- CreateIndex
CREATE INDEX "gps_events_tenantId_investigatorId_recordedAt_idx" ON "gps_events"("tenantId", "investigatorId", "recordedAt");

-- CreateIndex
CREATE INDEX "qc_rejection_reasons_tenantId_isActive_idx" ON "qc_rejection_reasons"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "qc_rejection_reasons_tenantId_code_key" ON "qc_rejection_reasons"("tenantId", "code");

-- CreateIndex
CREATE INDEX "qc_reviews_tenantId_investigationId_reviewedAt_idx" ON "qc_reviews"("tenantId", "investigationId", "reviewedAt");

-- CreateIndex
CREATE INDEX "qc_reviews_tenantId_reviewerId_idx" ON "qc_reviews"("tenantId", "reviewerId");

-- CreateIndex
CREATE INDEX "qc_review_reasons_reasonId_idx" ON "qc_review_reasons"("reasonId");

-- CreateIndex
CREATE INDEX "report_templates_tenantId_isActive_idx" ON "report_templates"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_tenantId_code_key" ON "report_templates"("tenantId", "code");

-- CreateIndex
CREATE INDEX "reports_tenantId_investigationId_idx" ON "reports"("tenantId", "investigationId");

-- CreateIndex
CREATE INDEX "reports_tenantId_status_idx" ON "reports"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reports_investigationId_version_key" ON "reports"("investigationId", "version");

-- CreateIndex
CREATE INDEX "export_jobs_tenantId_requestedById_createdAt_idx" ON "export_jobs"("tenantId", "requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "export_jobs_tenantId_status_idx" ON "export_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_readAt_idx" ON "notifications"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_investigatorId_readAt_idx" ON "notifications"("tenantId", "investigatorId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_createdAt_idx" ON "notifications"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_category_createdAt_idx" ON "audit_logs"("tenantId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_userId_createdAt_idx" ON "audit_logs"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "client_accounts_apiKeyHash_key" ON "client_accounts"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "client_accounts_portalUserId_key" ON "client_accounts"("portalUserId");

-- CreateIndex
CREATE INDEX "client_accounts_tenantId_isActive_idx" ON "client_accounts"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "client_accounts_tenantId_code_key" ON "client_accounts"("tenantId", "code");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigators" ADD CONSTRAINT "investigators_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigator_documents" ADD CONSTRAINT "investigator_documents_investigatorId_fkey" FOREIGN KEY ("investigatorId") REFERENCES "investigators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_investigatorId_fkey" FOREIGN KEY ("investigatorId") REFERENCES "investigators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_governorateId_fkey" FOREIGN KEY ("governorateId") REFERENCES "governorates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "districts" ADD CONSTRAINT "districts_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_reportTemplateId_fkey" FOREIGN KEY ("reportTemplateId") REFERENCES "report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_types" ADD CONSTRAINT "investigation_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_types" ADD CONSTRAINT "investigation_types_formTemplateId_fkey" FOREIGN KEY ("formTemplateId") REFERENCES "form_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_types" ADD CONSTRAINT "investigation_types_reportTemplateId_fkey" FOREIGN KEY ("reportTemplateId") REFERENCES "report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_investigation_types" ADD CONSTRAINT "product_investigation_types_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_investigation_types" ADD CONSTRAINT "product_investigation_types_investigationTypeId_fkey" FOREIGN KEY ("investigationTypeId") REFERENCES "investigation_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "escalation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_governorateId_fkey" FOREIGN KEY ("governorateId") REFERENCES "governorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_investigationTypeId_fkey" FOREIGN KEY ("investigationTypeId") REFERENCES "investigation_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_governorateId_fkey" FOREIGN KEY ("governorateId") REFERENCES "governorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_investigatorId_fkey" FOREIGN KEY ("investigatorId") REFERENCES "investigators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "form_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_status_history" ADD CONSTRAINT "investigation_status_history_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_comments" ADD CONSTRAINT "investigation_comments_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_investigatorId_fkey" FOREIGN KEY ("investigatorId") REFERENCES "investigators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_mappingTemplateId_fkey" FOREIGN KEY ("mappingTemplateId") REFERENCES "import_mapping_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_categories" ADD CONSTRAINT "media_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "media_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_events" ADD CONSTRAINT "gps_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_events" ADD CONSTRAINT "gps_events_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_events" ADD CONSTRAINT "gps_events_investigatorId_fkey" FOREIGN KEY ("investigatorId") REFERENCES "investigators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_rejection_reasons" ADD CONSTRAINT "qc_rejection_reasons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_review_reasons" ADD CONSTRAINT "qc_review_reasons_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "qc_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_review_reasons" ADD CONSTRAINT "qc_review_reasons_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "qc_rejection_reasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_investigatorId_fkey" FOREIGN KEY ("investigatorId") REFERENCES "investigators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

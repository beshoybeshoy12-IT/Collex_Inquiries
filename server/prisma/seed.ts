/* eslint-disable no-console */
import 'dotenv/config';
import {
  EscalationTrigger,
  InvestigationStatus,
  InvestigatorStatus,
  MediaType,
  PrismaClient,
  Priority,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PERMISSION_CATALOG } from '../src/common/constants/permissions';
import {
  SYSTEM_ROLES,
  SYSTEM_ROLE_CODES,
  permissionsFor,
} from '../src/common/constants/system-roles';
import { EGYPT_GEOGRAPHY } from './seed-data/geography';
import {
  DEFAULT_DISCLAIMER_AR,
  DEFAULT_DISCLAIMER_EN,
  DEFAULT_REPORT_BODY,
  DEFAULT_REPORT_CSS,
} from '../src/reports/report-template.default';
import { INQUIRY_FORMS } from './seed-data/forms';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Seed.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Runs in two halves:
 *
 *  1. PLATFORM DATA — the permission catalogue and Egypt's geography. Always
 *     applied, idempotent, safe against a live database. These are properties
 *     of the software and of the country, not of any customer.
 *
 *  2. DEMO DATA — a tenant with users, investigators, cases and a form. Applied
 *     only when `SEED_DEMO_DATA=true`, and every row it creates is marked as
 *     demo data in its own name so nobody mistakes it for real work.
 *
 *  THE SEEDER REFUSES TO INVENT A PASSWORD. `SEED_ADMIN_PASSWORD` is required
 *  for the demo half; there is no fallback, because a default admin password
 *  that ships in a repository is the single most reliable way to lose a system.
 *
 *  Idempotent throughout: re-running updates the catalogue and leaves existing
 *  tenant data alone. A tenant that has customised its roles does not get them
 *  reset by a redeploy.
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('\n═══ Collex Inquiries — seed ═══\n');

  await seedPermissions();
  await seedGeography();

  if (process.env.SEED_DEMO_DATA === 'true') {
    await seedDemoTenant();
  } else {
    console.log(
      '\n○ Demo data skipped (set SEED_DEMO_DATA=true to create the demo tenant)',
    );
  }

  console.log('\n═══ Seed complete ═══\n');
}

// ─────────────────────────────────────────────────────────────────────────────
//  1. Platform data
// ─────────────────────────────────────────────────────────────────────────────

async function seedPermissions(): Promise<void> {
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      create: permission,
      update: {
        category: permission.category,
        labelAr: permission.labelAr,
        labelEn: permission.labelEn,
        sortOrder: permission.sortOrder,
      },
    });
  }

  // A permission removed from the catalogue is deleted, which cascades to every
  // role grant — otherwise the table accumulates codes no guard will ever
  // check, and a role screen shows toggles that do nothing.
  const known = PERMISSION_CATALOG.map((p) => p.code);
  const { count } = await prisma.permission.deleteMany({
    where: { code: { notIn: known } },
  });

  console.log(
    `✓ Permissions: ${PERMISSION_CATALOG.length} in catalogue` +
      (count > 0 ? `, ${count} stale removed` : ''),
  );
}

async function seedGeography(): Promise<void> {
  let governorates = 0;
  let cities = 0;
  let districts = 0;
  let areas = 0;

  for (const g of EGYPT_GEOGRAPHY) {
    const governorate = await prisma.governorate.upsert({
      where: { code: g.code },
      create: { code: g.code, nameAr: g.nameAr, nameEn: g.nameEn },
      update: { nameAr: g.nameAr, nameEn: g.nameEn },
    });
    governorates++;

    for (const c of g.cities) {
      const city = await prisma.city.upsert({
        where: {
          governorateId_code: { governorateId: governorate.id, code: c.code },
        },
        create: {
          governorateId: governorate.id,
          code: c.code,
          nameAr: c.nameAr,
          nameEn: c.nameEn,
        },
        update: { nameAr: c.nameAr, nameEn: c.nameEn },
      });
      cities++;

      for (const d of c.districts ?? []) {
        const district = await prisma.district.upsert({
          where: { cityId_code: { cityId: city.id, code: d.code } },
          create: {
            cityId: city.id,
            code: d.code,
            nameAr: d.nameAr,
            nameEn: d.nameEn,
          },
          update: { nameAr: d.nameAr, nameEn: d.nameEn },
        });
        districts++;

        for (const a of d.areas ?? []) {
          await prisma.area.upsert({
            where: { districtId_code: { districtId: district.id, code: a.code } },
            create: {
              districtId: district.id,
              code: a.code,
              nameAr: a.nameAr,
              nameEn: a.nameEn,
            },
            update: { nameAr: a.nameAr, nameEn: a.nameEn },
          });
          areas++;
        }
      }
    }
  }

  console.log(
    `✓ Geography: ${governorates} governorates, ${cities} cities, ` +
      `${districts} districts, ${areas} areas`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  2. Demo data
// ─────────────────────────────────────────────────────────────────────────────

async function seedDemoTenant(): Promise<void> {
  const code = (process.env.SEED_TENANT_CODE ?? 'DEMO').toUpperCase();
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.local';
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    console.error(
      '\n✗ SEED_ADMIN_PASSWORD is not set. The seeder will not invent one — ' +
        'a default admin password that ships in a repository is how systems ' +
        'get lost. Set it in .env and run again.\n',
    );
    process.exitCode = 1;
    return;
  }
  if (password.length < 10) {
    console.error('\n✗ SEED_ADMIN_PASSWORD must be at least 10 characters.\n');
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.tenant.findUnique({ where: { code } });
  if (existing) {
    console.log(
      `\n○ Tenant "${code}" already exists — leaving it untouched.\n` +
        `  Re-seeding a live tenant would undo whatever an administrator has\n` +
        `  configured since. Delete it first if you want a clean demo.`,
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  console.log(`\n── Creating demo tenant "${code}" ──`);

  const tenant = await prisma.tenant.create({
    data: {
      code,
      nameAr: 'شركة كوليكس للاستعلامات الميدانية (بيانات تجريبية)',
      nameEn: 'Collex Field Inquiries (DEMO DATA)',
      status: 'ACTIVE',
      email: 'info@demo.local',
      phone: '+20 2 1234 5678',
      addressLine: '12 Tahrir Street, Dokki, Giza',
      defaultLocale: 'ar',
      timezone: 'Africa/Cairo',
      maxWebUsers: 50,
      maxInvestigators: 200,
      subscriptionStart: new Date(),
      subscriptionEnd: new Date(Date.now() + 365 * 86_400_000),
      featureFlags: {},
    },
  });

  // ── Roles ────────────────────────────────────────────────────────────────
  const roleIds = new Map<string, string>();
  for (const definition of SYSTEM_ROLES) {
    const role = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        code: definition.code,
        nameAr: definition.nameAr,
        nameEn: definition.nameEn,
        description: definition.description,
        rank: definition.rank,
        isSystem: true,
        permissions: {
          create: permissionsFor(definition).map((permissionCode) => ({
            permissionCode,
          })),
        },
      },
    });
    roleIds.set(definition.code, role.id);
  }
  console.log(`✓ Roles: ${SYSTEM_ROLES.length}`);

  // ── Geography lookups the demo rows need ────────────────────────────────
  const cairo = await prisma.governorate.findUniqueOrThrow({ where: { code: 'C' } });
  const giza = await prisma.governorate.findUniqueOrThrow({ where: { code: 'GZ' } });
  const alex = await prisma.governorate.findUniqueOrThrow({ where: { code: 'ALX' } });

  const nasrCity = await prisma.city.findFirstOrThrow({
    where: { governorateId: cairo.id, code: 'NASR_CITY' },
  });
  const maadi = await prisma.city.findFirstOrThrow({
    where: { governorateId: cairo.id, code: 'MAADI' },
  });
  const dokki = await prisma.city.findFirstOrThrow({
    where: { governorateId: giza.id, code: 'DOKKI' },
  });

  // ── Web users ────────────────────────────────────────────────────────────
  const users = [
    {
      email: adminEmail,
      fullName: 'مدير النظام (تجريبي) / System Admin (demo)',
      role: SYSTEM_ROLE_CODES.COMPANY_ADMIN,
      employeeCode: 'ADM-001',
    },
    {
      email: 'coordinator@demo.local',
      fullName: 'منى عبد الرحمن (تجريبي) / Mona Abdelrahman (demo)',
      role: SYSTEM_ROLE_CODES.COORDINATOR,
      employeeCode: 'COR-001',
    },
    {
      email: 'supervisor@demo.local',
      fullName: 'خالد فؤاد (تجريبي) / Khaled Fouad (demo)',
      role: SYSTEM_ROLE_CODES.SUPERVISOR,
      employeeCode: 'SUP-001',
    },
    {
      email: 'qc@demo.local',
      fullName: 'سارة منصور (تجريبي) / Sara Mansour (demo)',
      role: SYSTEM_ROLE_CODES.QC_OFFICER,
      employeeCode: 'QCO-001',
    },
    {
      email: 'reports@demo.local',
      fullName: 'أحمد سليم (تجريبي) / Ahmed Selim (demo)',
      role: SYSTEM_ROLE_CODES.REPORT_USER,
      employeeCode: 'RPT-001',
    },
  ];

  const userIds = new Map<string, string>();
  for (const u of users) {
    const created = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: u.email,
        fullName: u.fullName,
        employeeCode: u.employeeCode,
        passwordHash,
        roleId: roleIds.get(u.role),
        status: 'ACTIVE',
        locale: 'ar',
      },
    });
    userIds.set(u.role, created.id);
  }
  console.log(`✓ Web users: ${users.length} (all share SEED_ADMIN_PASSWORD)`);

  // ── Catalogue: investigation types and products ─────────────────────────
  const typeDefinitions = [
    { code: 'RESIDENCE', nameAr: 'استعلام سكن', nameEn: 'Residence Verification', colorHex: '#2563eb', sla: 48 },
    { code: 'WORKPLACE', nameAr: 'استعلام عمل', nameEn: 'Workplace Verification', colorHex: '#7c3aed', sla: 48 },
    { code: 'EMPLOYMENT', nameAr: 'تحقق من التوظيف', nameEn: 'Employment Verification', colorHex: '#0891b2', sla: 72 },
    { code: 'BUSINESS', nameAr: 'استعلام نشاط تجاري', nameEn: 'Business Verification', colorHex: '#059669', sla: 72 },
    { code: 'REFERENCE', nameAr: 'استعلام معرّفين', nameEn: 'Reference Verification', colorHex: '#d97706', sla: 24 },
    { code: 'PROPERTY', nameAr: 'معاينة عقار', nameEn: 'Property Verification', colorHex: '#65a30d', sla: 96 },
    { code: 'VEHICLE', nameAr: 'معاينة مركبة', nameEn: 'Vehicle Verification', colorHex: '#dc2626', sla: 48 },
    { code: 'KYC', nameAr: 'اعرف عميلك', nameEn: 'KYC Verification', colorHex: '#4f46e5', sla: 24 },
    { code: 'RECOVERY_VISIT', nameAr: 'زيارة تحصيل', nameEn: 'Recovery Visit', colorHex: '#ea580c', sla: 24 },
    { code: 'FRAUD', nameAr: 'تحقيق احتيال', nameEn: 'Fraud Investigation', colorHex: '#991b1b', sla: 120 },
  ];

  const typeIds = new Map<string, string>();
  for (const t of typeDefinitions) {
    const created = await prisma.investigationType.create({
      data: {
        tenantId: tenant.id,
        code: t.code,
        nameAr: t.nameAr,
        nameEn: t.nameEn,
        colorHex: t.colorHex,
        defaultSlaHours: t.sla,
        isActive: true,
      },
    });
    typeIds.set(t.code, created.id);
  }
  console.log(`✓ Investigation types: ${typeDefinitions.length}`);

  const productDefinitions = [
    { code: 'PERSONAL_LOAN', nameAr: 'قرض شخصي', nameEn: 'Personal Loan', sla: 48, price: 250 },
    { code: 'CREDIT_CARD', nameAr: 'بطاقة ائتمان', nameEn: 'Credit Card', sla: 48, price: 200 },
    { code: 'AUTO_LOAN', nameAr: 'قرض سيارة', nameEn: 'Auto Loan', sla: 72, price: 350 },
    { code: 'MORTGAGE', nameAr: 'تمويل عقاري', nameEn: 'Mortgage', sla: 120, price: 600 },
    { code: 'BUSINESS_LOAN', nameAr: 'قرض تجاري', nameEn: 'Business Loan', sla: 96, price: 500 },
    { code: 'MICROFINANCE', nameAr: 'تمويل متناهي الصغر', nameEn: 'Microfinance', sla: 24, price: 120 },
    { code: 'FAST', nameAr: 'استعلام سريع', nameEn: 'Fast Inquiry', sla: 12, price: 150 },
  ];

  const productIds = new Map<string, string>();
  for (const p of productDefinitions) {
    const created = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        code: p.code,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        defaultSlaHours: p.sla,
        defaultPriority: Priority.NORMAL,
        price: p.price,
        isActive: true,
      },
    });
    productIds.set(p.code, created.id);

    // Every product allows residence and workplace; the rest are enabled where
    // they make sense, so the pairing table is exercised rather than uniform.
    const allowed =
      p.code === 'AUTO_LOAN'
        ? ['RESIDENCE', 'WORKPLACE', 'VEHICLE']
        : p.code === 'MORTGAGE'
          ? ['RESIDENCE', 'WORKPLACE', 'PROPERTY']
          : p.code === 'BUSINESS_LOAN'
            ? ['RESIDENCE', 'BUSINESS', 'REFERENCE']
            : p.code === 'FAST'
              ? ['RESIDENCE', 'KYC']
              : ['RESIDENCE', 'WORKPLACE', 'EMPLOYMENT', 'KYC'];

    await prisma.productInvestigationType.createMany({
      data: allowed.map((typeCode) => ({
        productId: created.id,
        investigationTypeId: typeIds.get(typeCode)!,
        slaHours: p.sla,
        price: p.price,
        isActive: true,
      })),
    });
  }
  console.log(`✓ Products: ${productDefinitions.length}, with type pairings`);

  // ── Media categories ─────────────────────────────────────────────────────
  const categories = [
    { code: 'RESIDENCE_FRONT', nameAr: 'واجهة السكن', nameEn: 'Residence Front', required: true, min: 1 },
    { code: 'RESIDENCE_ENTRANCE', nameAr: 'مدخل السكن', nameEn: 'Residence Entrance', required: true, min: 1 },
    { code: 'STREET_VIEW', nameAr: 'منظر الشارع', nameEn: 'Street View', required: false, min: 0 },
    { code: 'WORKPLACE_FRONT', nameAr: 'واجهة العمل', nameEn: 'Workplace Front', required: false, min: 0 },
    { code: 'WORKPLACE_INTERIOR', nameAr: 'داخل مقر العمل', nameEn: 'Workplace Interior', required: false, min: 0 },
    { code: 'ID_FRONT', nameAr: 'البطاقة - الوجه', nameEn: 'ID Front', required: false, min: 0 },
    { code: 'ID_BACK', nameAr: 'البطاقة - الظهر', nameEn: 'ID Back', required: false, min: 0 },
    { code: 'DOCUMENT', nameAr: 'مستند', nameEn: 'Document', required: false, min: 0, type: MediaType.DOCUMENT },
    { code: 'ADDITIONAL', nameAr: 'أدلة إضافية', nameEn: 'Additional Evidence', required: false, min: 0 },
    { code: 'SIGNATURE', nameAr: 'التوقيع', nameEn: 'Signature', required: false, min: 0, type: MediaType.SIGNATURE },
  ];

  await prisma.mediaCategory.createMany({
    data: categories.map((c, index) => ({
      tenantId: tenant.id,
      code: c.code,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      mediaType: c.type ?? MediaType.PHOTO,
      isRequired: c.required,
      minCount: c.min,
      sortOrder: index,
      isActive: true,
    })),
  });
  console.log(`✓ Media categories: ${categories.length}`);

  // ── QC rejection reasons ─────────────────────────────────────────────────
  const reasons = [
    { code: 'MISSING_PHOTO', nameAr: 'صورة مفقودة', nameEn: 'Missing Photo' },
    { code: 'INVALID_PHOTO', nameAr: 'صورة غير صالحة', nameEn: 'Invalid Photo' },
    { code: 'MISSING_DATA', nameAr: 'بيانات ناقصة', nameEn: 'Missing Data' },
    { code: 'WRONG_ADDRESS', nameAr: 'عنوان خاطئ', nameEn: 'Wrong Address' },
    { code: 'GPS_PROBLEM', nameAr: 'مشكلة في تحديد الموقع', nameEn: 'GPS Problem' },
    { code: 'UNCLEAR_DOCUMENT', nameAr: 'مستند غير واضح', nameEn: 'Unclear Document' },
    { code: 'INCORRECT_INFO', nameAr: 'معلومات غير صحيحة', nameEn: 'Incorrect Information' },
    { code: 'OTHER', nameAr: 'أخرى', nameEn: 'Other', needsNote: true },
  ];

  await prisma.qcRejectionReason.createMany({
    data: reasons.map((r, index) => ({
      tenantId: tenant.id,
      code: r.code,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      needsNote: r.needsNote ?? false,
      sortOrder: index,
      isActive: true,
    })),
  });
  console.log(`✓ QC rejection reasons: ${reasons.length}`);

  // ── SLA policy and escalation rules ─────────────────────────────────────
  const slaPolicy = await prisma.slaPolicy.create({
    data: {
      tenantId: tenant.id,
      code: 'STANDARD_48H',
      nameAr: 'الاتفاقية القياسية - 48 ساعة',
      nameEn: 'Standard 48-hour SLA',
      totalHours: 48,
      assignmentHours: 4,
      acceptanceHours: 2,
      fieldHours: 24,
      qcHours: 12,
      warnAtPercent: 80,
      businessHoursOnly: false,
      workdayStartHour: 9,
      workdayEndHour: 17,
      workdays: [7, 1, 2, 3, 4],
      isDefault: true,
      isActive: true,
    },
  });

  await prisma.slaPolicy.create({
    data: {
      tenantId: tenant.id,
      code: 'URGENT_12H',
      nameAr: 'اتفاقية عاجلة - 12 ساعة',
      nameEn: 'Urgent 12-hour SLA',
      priority: Priority.URGENT,
      totalHours: 12,
      assignmentHours: 1,
      acceptanceHours: 1,
      fieldHours: 6,
      qcHours: 4,
      warnAtPercent: 70,
      businessHoursOnly: false,
      workdayStartHour: 9,
      workdayEndHour: 17,
      workdays: [7, 1, 2, 3, 4],
      isActive: true,
    },
  });

  const escalationRules = [
    {
      code: 'NOT_ACCEPTED_2H',
      nameAr: 'لم يتم قبول الإسناد خلال ساعتين',
      nameEn: 'Assignment not accepted within 2 hours',
      trigger: EscalationTrigger.NOT_ACCEPTED,
      thresholdMinutes: 120,
      notifyCoordinator: true,
      notifyInvestigator: true,
    },
    {
      code: 'NOT_STARTED_8H',
      nameAr: 'لم يبدأ العمل خلال 8 ساعات',
      nameEn: 'Work not started within 8 hours',
      trigger: EscalationTrigger.NOT_STARTED,
      thresholdMinutes: 480,
      notifyCoordinator: true,
      notifyInvestigator: true,
    },
    {
      code: 'SLA_WARNING',
      nameAr: 'اقتراب من موعد الاستحقاق',
      nameEn: 'Approaching the SLA deadline',
      trigger: EscalationTrigger.SLA_WARNING,
      thresholdMinutes: 1,
      notifyCoordinator: true,
      notifyRoleCodes: [SYSTEM_ROLE_CODES.SUPERVISOR],
    },
    {
      code: 'SLA_BREACH',
      nameAr: 'تجاوز موعد الاستحقاق',
      nameEn: 'SLA breached',
      trigger: EscalationTrigger.SLA_BREACH,
      thresholdMinutes: 1,
      repeatEveryMinutes: 720,
      notifyCoordinator: true,
      notifyRoleCodes: [SYSTEM_ROLE_CODES.SUPERVISOR, SYSTEM_ROLE_CODES.COMPANY_ADMIN],
    },
    {
      code: 'QC_PENDING_24H',
      nameAr: 'انتظار مراجعة الجودة لأكثر من 24 ساعة',
      nameEn: 'Awaiting QC for more than 24 hours',
      trigger: EscalationTrigger.QC_PENDING_TOO_LONG,
      thresholdMinutes: 1440,
      notifyRoleCodes: [SYSTEM_ROLE_CODES.QC_OFFICER, SYSTEM_ROLE_CODES.SUPERVISOR],
      notifyCoordinator: false,
    },
  ];

  for (const rule of escalationRules) {
    await prisma.escalationRule.create({
      data: {
        tenantId: tenant.id,
        code: rule.code,
        nameAr: rule.nameAr,
        nameEn: rule.nameEn,
        trigger: rule.trigger,
        thresholdMinutes: rule.thresholdMinutes,
        repeatEveryMinutes: rule.repeatEveryMinutes,
        notifyRoleCodes: rule.notifyRoleCodes ?? [],
        notifyCoordinator: rule.notifyCoordinator ?? true,
        notifyInvestigator: rule.notifyInvestigator ?? false,
        isActive: true,
      },
    });
  }
  console.log(
    `✓ SLA: 2 policies, ${escalationRules.length} escalation rules ` +
      `(all thresholds configurable)`,
  );

  // ── Report template ──────────────────────────────────────────────────────
  const reportTemplate = await prisma.reportTemplate.create({
    data: {
      tenantId: tenant.id,
      code: 'STANDARD_AR',
      nameAr: 'التقرير القياسي',
      nameEn: 'Standard Report',
      description: 'Bilingual A4 field investigation report.',
      bodyHtml: DEFAULT_REPORT_BODY,
      css: DEFAULT_REPORT_CSS,
      showLogo: true,
      showQrCode: true,
      showWatermark: false,
      disclaimerAr: DEFAULT_DISCLAIMER_AR,
      disclaimerEn: DEFAULT_DISCLAIMER_EN,
      pageSize: 'A4',
      isDefault: true,
      isActive: true,
    },
  });
  console.log('✓ Report template: STANDARD_AR (default)');

  // ── Forms ────────────────────────────────────────────────────────────────
  for (const { typeCode, templateCode, schema, nameAr, nameEn } of INQUIRY_FORMS) {
    const template = await prisma.formTemplate.create({
      data: {
        tenantId: tenant.id,
        code: templateCode,
        nameAr,
        nameEn,
        isActive: true,
        versions: {
          create: {
            tenantId: tenant.id,
            version: 1,
            isPublished: true,
            publishedAt: new Date(),
            schema: schema as never,
            changeNote: 'Initial version',
          },
        },
      },
      include: { versions: true },
    });

    await prisma.formTemplate.update({
      where: { id: template.id },
      data: { publishedVersionId: template.versions[0].id },
    });

    await prisma.investigationType.update({
      where: { id: typeIds.get(typeCode)! },
      data: {
        formTemplateId: template.id,
        reportTemplateId: reportTemplate.id,
        requiredPhotoCategories:
          typeCode === 'RESIDENCE'
            ? ['RESIDENCE_FRONT', 'RESIDENCE_ENTRANCE']
            : ['WORKPLACE_FRONT'],
      },
    });
  }
  console.log('✓ Forms: 2 published templates, wired to their types');

  // ── Field investigators ──────────────────────────────────────────────────
  const investigators = [
    {
      code: 'INV-001',
      name: 'محمود السيد (تجريبي) / Mahmoud El Sayed (demo)',
      phone: '01001234501',
      governorates: [cairo.id],
      status: InvestigatorStatus.ACTIVE,
      quality: 92,
      completed: 148,
      rejected: 6,
      lat: 30.0626,
      lng: 31.3390,
    },
    {
      code: 'INV-002',
      name: 'هبة إبراهيم (تجريبي) / Heba Ibrahim (demo)',
      phone: '01001234502',
      governorates: [cairo.id, giza.id],
      status: InvestigatorStatus.ACTIVE,
      quality: 88,
      completed: 96,
      rejected: 9,
      lat: 30.0384,
      lng: 31.2085,
    },
    {
      code: 'INV-003',
      name: 'عمرو حسن (تجريبي) / Amr Hassan (demo)',
      phone: '01001234503',
      governorates: [giza.id],
      status: InvestigatorStatus.ACTIVE,
      quality: 95,
      completed: 210,
      rejected: 4,
      lat: 29.9870,
      lng: 31.2118,
    },
    {
      code: 'INV-004',
      name: 'نورا عادل (تجريبي) / Nora Adel (demo)',
      phone: '01001234504',
      governorates: [alex.id],
      status: InvestigatorStatus.ACTIVE,
      quality: 81,
      completed: 54,
      rejected: 11,
      lat: 31.2001,
      lng: 29.9187,
    },
    {
      code: 'INV-005',
      name: 'كريم مصطفى (تجريبي) / Karim Mostafa (demo)',
      phone: '01001234505',
      governorates: [cairo.id],
      status: InvestigatorStatus.IN_TRAINING,
      quality: null,
      completed: 0,
      rejected: 0,
      lat: null,
      lng: null,
    },
  ];

  const investigatorIds: string[] = [];
  for (const inv of investigators) {
    const created = await prisma.investigator.create({
      data: {
        tenantId: tenant.id,
        employeeCode: inv.code,
        fullName: inv.name,
        phone: inv.phone,
        passwordHash,
        status: inv.status,
        availability: inv.status === InvestigatorStatus.ACTIVE ? 'AVAILABLE' : 'OFFLINE',
        governorateIds: inv.governorates,
        investigationTypeIds: [...typeIds.values()],
        productIds: [...productIds.values()],
        maxDailyCases: 15,
        maxOpenCases: 30,
        qualityScore: inv.quality,
        completedCount: inv.completed,
        rejectedCount: inv.rejected,
        avgTatMinutes: inv.completed > 0 ? 900 + inv.rejected * 20 : null,
        lastLat: inv.lat,
        lastLng: inv.lng,
        lastLocationAt: inv.lat ? new Date() : null,
        lastActivityAt: inv.lat ? new Date() : null,
        trainingCompletedAt:
          inv.status === InvestigatorStatus.ACTIVE ? new Date('2025-06-01') : null,
      },
    });
    investigatorIds.push(created.id);
  }
  console.log(
    `✓ Field investigators: ${investigators.length} (sign in with the ` +
      `employee code or phone plus the company code)`,
  );

  // ── Customers and cases ──────────────────────────────────────────────────
  const customerSeeds = [
    {
      name: 'أحمد محمد علي حسن (تجريبي)',
      nid: '29001011200011',
      mobile: '01111000011',
      address: '15 شارع عباس العقاد، الدور الثالث، شقة 12',
      gov: cairo.id,
      city: nasrCity.id,
      work: 'شركة النيل للتجارة',
      job: 'محاسب',
    },
    {
      name: 'فاطمة السيد إبراهيم (تجريبي)',
      nid: '29505152200022',
      mobile: '01111000022',
      address: '8 شارع 9، دجلة، المعادي',
      gov: cairo.id,
      city: maadi.id,
      work: 'مستشفى المعادي التخصصي',
      job: 'ممرضة',
    },
    {
      name: 'محمد عبد الله فتحي (تجريبي)',
      nid: '28807073300033',
      mobile: '01111000033',
      address: '22 شارع التحرير، الدقي',
      gov: giza.id,
      city: dokki.id,
      work: 'بنك القاهرة - فرع الدقي',
      job: 'مسؤول علاقات عملاء',
    },
    {
      name: 'مريم خالد رشاد (تجريبي)',
      nid: '29212124400044',
      mobile: '01111000044',
      address: '5 شارع مكرم عبيد، مدينة نصر',
      gov: cairo.id,
      city: nasrCity.id,
      work: 'شركة أوراسكوم',
      job: 'مهندسة مدنية',
    },
    {
      name: 'يوسف سامي عبد الحميد (تجريبي)',
      nid: '29009095500055',
      mobile: '01111000055',
      address: '30 شارع 105، حدائق المعادي',
      gov: cairo.id,
      city: maadi.id,
      work: 'مطاعم الشبراوي',
      job: 'مدير فرع',
    },
  ];

  const coordinatorId = userIds.get(SYSTEM_ROLE_CODES.COORDINATOR)!;
  const period = `${String(new Date().getFullYear()).slice(2)}${String(
    new Date().getMonth() + 1,
  ).padStart(2, '0')}`;

  // The case-number sequence is created by CaseNumberService at runtime; the
  // seed writes literal numbers in the same shape so the demo data is
  // indistinguishable from real cases on screen. Starting at 900 keeps it well
  // clear of anything the sequence will hand out.
  let sequence = 900;
  const nextCaseNumber = () =>
    `INQ-${code}-${period}-${String(sequence++).padStart(6, '0')}`;

  // A spread across the workflow so every screen has something on it.
  const caseStates: {
    status: InvestigationStatus;
    investigatorIndex?: number;
    assigned?: boolean;
    accepted?: boolean;
    submitted?: boolean;
  }[] = [
    { status: InvestigationStatus.NEW },
    { status: InvestigationStatus.READY_FOR_ASSIGNMENT },
    { status: InvestigationStatus.ASSIGNED, investigatorIndex: 0, assigned: true },
    {
      status: InvestigationStatus.IN_PROGRESS,
      investigatorIndex: 1,
      assigned: true,
      accepted: true,
    },
    {
      status: InvestigationStatus.QC_PENDING,
      investigatorIndex: 2,
      assigned: true,
      accepted: true,
      submitted: true,
    },
  ];

  let created = 0;
  for (const [index, seed] of customerSeeds.entries()) {
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        fullName: seed.name,
        nationalId: seed.nid,
        mobile: seed.mobile,
        residenceAddress: seed.address,
        governorateId: seed.gov,
        cityId: seed.city,
        workplaceName: seed.work,
        jobTitle: seed.job,
        createdById: coordinatorId,
      },
    });

    const state = caseStates[index % caseStates.length];
    const now = Date.now();
    const createdAt = new Date(now - (index + 1) * 6 * 3_600_000);

    const investigation = await prisma.investigation.create({
      data: {
        tenantId: tenant.id,
        caseNumber: nextCaseNumber(),
        applicationNumber: `APP-2026-${String(1000 + index).padStart(5, '0')}`,
        customerId: customer.id,
        productId: productIds.get(index % 2 === 0 ? 'PERSONAL_LOAN' : 'CREDIT_CARD')!,
        investigationTypeId: typeIds.get('RESIDENCE')!,
        status: state.status,
        priority: index === 0 ? Priority.URGENT : Priority.NORMAL,
        source: 'MANUAL',
        addressLine: seed.address,
        governorateId: seed.gov,
        cityId: seed.city,
        coordinatorId,
        createdById: coordinatorId,
        slaPolicyId: slaPolicy.id,
        dueAt: new Date(createdAt.getTime() + 48 * 3_600_000),
        createdAt,
        investigatorId:
          state.investigatorIndex !== undefined
            ? investigatorIds[state.investigatorIndex]
            : null,
        assignedAt: state.assigned ? new Date(createdAt.getTime() + 3_600_000) : null,
        acceptedAt: state.accepted ? new Date(createdAt.getTime() + 5_400_000) : null,
        submittedAt: state.submitted
          ? new Date(createdAt.getTime() + 4 * 3_600_000)
          : null,
      },
    });

    await prisma.investigationStatusHistory.create({
      data: {
        tenantId: tenant.id,
        investigationId: investigation.id,
        toStatus: InvestigationStatus.NEW,
        actorType: 'WEB_USER',
        actorId: coordinatorId,
        actorName: 'Seed',
        reason: 'Demo data',
        createdAt,
      },
    });

    if (state.assigned && state.investigatorIndex !== undefined) {
      await prisma.assignment.create({
        data: {
          tenantId: tenant.id,
          investigationId: investigation.id,
          investigatorId: investigatorIds[state.investigatorIndex],
          assignedById: coordinatorId,
          status: state.accepted ? 'ACCEPTED' : 'PENDING',
          method: 'MANUAL',
          assignedAt: new Date(createdAt.getTime() + 3_600_000),
          respondedAt: state.accepted
            ? new Date(createdAt.getTime() + 5_400_000)
            : null,
        },
      });
    }

    created++;
  }
  console.log(`✓ Demo cases: ${created} customers with one case each`);

  // ── Import mapping template ──────────────────────────────────────────────
  await prisma.importMappingTemplate.create({
    data: {
      tenantId: tenant.id,
      code: 'STANDARD_BANK',
      nameAr: 'قالب البنك القياسي',
      nameEn: 'Standard Bank Format',
      description: 'Matches the header names in the downloadable import template.',
      mapping: {
        fullName: 'Customer Name | اسم العميل',
        nationalId: 'National ID | الرقم القومي',
        mobile: 'Customer Phone | رقم الموبايل',
        residenceAddress: 'Residence Address | عنوان السكن',
        governorate: 'Governorate | المحافظة',
        city: 'City | المدينة',
        workplaceName: 'Workplace Name | جهة العمل',
        workplaceAddress: 'Workplace Address | عنوان العمل',
        applicationNumber: 'Application Number | رقم الطلب',
        product: 'Product | المنتج',
        investigationType: 'Investigation Type | نوع الاستعلام',
        priority: 'Priority | الأولوية',
        dueDate: 'Due Date | تاريخ الاستحقاق',
      },
      isDefault: true,
      isActive: true,
    },
  });
  console.log('✓ Import mapping template: STANDARD_BANK');

  console.log(`
┌──────────────────────────────────────────────────────────────┐
│  DEMO TENANT READY                                           │
├──────────────────────────────────────────────────────────────┤
│  Company code : ${code.padEnd(45)}│
│                                                              │
│  Web sign-in (password = SEED_ADMIN_PASSWORD):               │
│    ${adminEmail.padEnd(58)}│
│    coordinator@demo.local        (Coordinator)               │
│    supervisor@demo.local         (Supervisor)                │
│    qc@demo.local                 (QC Officer)                │
│    reports@demo.local            (Report User)               │
│                                                              │
│  Investigator sign-in (same password, needs company code):   │
│    INV-001 … INV-005, or the phone 01001234501 …             │
│                                                              │
│  Every demo row is labelled (تجريبي) / (demo).               │
└──────────────────────────────────────────────────────────────┘`);
}

main()
  .catch((error) => {
    console.error('\n✗ Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

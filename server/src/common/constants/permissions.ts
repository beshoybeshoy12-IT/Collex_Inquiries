/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The permission catalogue.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Every permission the software understands is declared here exactly once,
 *  and the seeder mirrors this list into the `permissions` table. Two
 *  consequences that matter:
 *
 *  1. `@RequirePermission(P.INVESTIGATIONS_ASSIGN)` is checked against a
 *     constant, not a string literal, so a typo is a compile error rather than
 *     an endpoint that silently allows everyone through. A guard that fails
 *     open on a misspelled permission name is worse than no guard.
 *
 *  2. The client renders its permission matrix from `GET /api/v1/permissions`,
 *     which reads the same table. There is no second list to keep in step.
 *
 *  Roles are bundles of these, defined per tenant and editable. Nothing in the
 *  codebase branches on a role name — see `roles/system-roles.ts` for the
 *  seeded defaults and why they are only defaults.
 */

export const P = {
  // ─── Investigations / cases ───────────────────────────────────────────────
  INVESTIGATIONS_VIEW: 'investigations.view',
  /** Sees every case in the tenant, not just their own or their governorate's. */
  INVESTIGATIONS_VIEW_ALL: 'investigations.view_all',
  INVESTIGATIONS_CREATE: 'investigations.create',
  INVESTIGATIONS_EDIT: 'investigations.edit',
  INVESTIGATIONS_DELETE: 'investigations.delete',
  INVESTIGATIONS_IMPORT: 'investigations.import',
  INVESTIGATIONS_ASSIGN: 'investigations.assign',
  INVESTIGATIONS_REASSIGN: 'investigations.reassign',
  INVESTIGATIONS_CANCEL: 'investigations.cancel',
  INVESTIGATIONS_EXPORT: 'investigations.export',
  INVESTIGATIONS_ARCHIVE: 'investigations.archive',
  INVESTIGATIONS_COMMENT: 'investigations.comment',
  /**
   * Move a case to ANY status, outside the state machine, with a written
   * reason. For correcting mistakes; every use is a WARNING in the audit log.
   */
  INVESTIGATIONS_OVERRIDE_STATUS: 'investigations.override_status',

  // ─── Customers ────────────────────────────────────────────────────────────
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_EDIT: 'customers.edit',
  CUSTOMERS_DELETE: 'customers.delete',
  CUSTOMERS_MERGE: 'customers.merge',
  CUSTOMERS_EXPORT: 'customers.export',

  // ─── Web users ────────────────────────────────────────────────────────────
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_EDIT: 'users.edit',
  USERS_DISABLE: 'users.disable',
  USERS_DELETE: 'users.delete',
  USERS_RESET_PASSWORD: 'users.reset_password',
  USERS_MANAGE_SESSIONS: 'users.manage_sessions',
  USERS_VIEW_ACTIVITY: 'users.view_activity',

  // ─── Roles and permissions ────────────────────────────────────────────────
  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_EDIT: 'roles.edit',
  ROLES_DELETE: 'roles.delete',
  PERMISSIONS_ASSIGN: 'permissions.assign',

  // ─── Field investigators ──────────────────────────────────────────────────
  INVESTIGATORS_VIEW: 'investigators.view',
  INVESTIGATORS_CREATE: 'investigators.create',
  INVESTIGATORS_EDIT: 'investigators.edit',
  INVESTIGATORS_DISABLE: 'investigators.disable',
  INVESTIGATORS_DELETE: 'investigators.delete',
  INVESTIGATORS_RESET_PASSWORD: 'investigators.reset_password',
  INVESTIGATORS_VIEW_PERFORMANCE: 'investigators.view_performance',
  /**
   * Separate from viewing the investigator record at all. Live position is
   * surveillance-adjacent data about an employee; a coordinator who needs to
   * see a workload does not automatically need to see where someone is
   * standing.
   */
  INVESTIGATORS_VIEW_LOCATION: 'investigators.view_location',

  // ─── Imports ──────────────────────────────────────────────────────────────
  IMPORTS_VIEW: 'imports.view',
  IMPORTS_CREATE: 'imports.create',
  IMPORTS_CONFIRM: 'imports.confirm',
  IMPORTS_CANCEL: 'imports.cancel',
  IMPORTS_MANAGE_MAPPINGS: 'imports.manage_mappings',
  /** Overriding duplicate detection — a deliberately narrow grant. */
  IMPORTS_RESOLVE_DUPLICATES: 'imports.resolve_duplicates',

  // ─── Quality control ──────────────────────────────────────────────────────
  QC_VIEW: 'qc.view',
  QC_APPROVE: 'qc.approve',
  QC_REJECT: 'qc.reject',
  QC_REWORK: 'qc.rework',
  QC_MANAGE_REASONS: 'qc.manage_reasons',

  // ─── Reports and exports ──────────────────────────────────────────────────
  REPORTS_VIEW: 'reports.view',
  REPORTS_GENERATE: 'reports.generate',
  REPORTS_DOWNLOAD: 'reports.download',
  REPORTS_EXPORT: 'reports.export',
  REPORTS_MANAGE_TEMPLATES: 'reports.manage_templates',

  // ─── Media ────────────────────────────────────────────────────────────────
  MEDIA_VIEW: 'media.view',
  MEDIA_UPLOAD: 'media.upload',
  MEDIA_DELETE: 'media.delete',
  MEDIA_DOWNLOAD: 'media.download',

  // ─── Forms ────────────────────────────────────────────────────────────────
  FORMS_VIEW: 'forms.view',
  FORMS_CREATE: 'forms.create',
  FORMS_EDIT: 'forms.edit',
  FORMS_PUBLISH: 'forms.publish',
  FORMS_DELETE: 'forms.delete',

  // ─── Catalogue: products, investigation types, geography ──────────────────
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_MANAGE: 'products.manage',
  INVESTIGATION_TYPES_VIEW: 'investigation_types.view',
  INVESTIGATION_TYPES_MANAGE: 'investigation_types.manage',

  // ─── SLA and escalation ───────────────────────────────────────────────────
  SLA_VIEW: 'sla.view',
  SLA_MANAGE: 'sla.manage',

  // ─── Dashboard and analytics ──────────────────────────────────────────────
  DASHBOARD_VIEW: 'dashboard.view',
  ANALYTICS_VIEW: 'analytics.view',
  /** Figures for the whole tenant rather than the viewer's own slice. */
  ANALYTICS_VIEW_ALL: 'analytics.view_all',

  // ─── Audit ────────────────────────────────────────────────────────────────
  AUDIT_VIEW: 'audit.view',

  // ─── Settings and tenant administration ───────────────────────────────────
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  TENANT_MANAGE: 'tenant.manage',

  // ─── Clients ("الجهات"): the banks and companies, their logo and template ──
  CLIENTS_VIEW: 'clients.view',
  CLIENTS_MANAGE: 'clients.manage',

  // ─── Notifications ────────────────────────────────────────────────────────
  NOTIFICATIONS_VIEW: 'notifications.view',
  NOTIFICATIONS_BROADCAST: 'notifications.broadcast',

  // ─── Office attendance and announcements ──────────────────────────────────
  /** Everyone records their own attendance; this sees everybody's. */
  ATTENDANCE_VIEW_ALL: 'attendance.view_all',
  /** Publish, edit and remove announcements, and see who has read them. */
  ANNOUNCEMENTS_MANAGE: 'announcements.manage',
} as const;

export type PermissionCode = (typeof P)[keyof typeof P];

/** Metadata for one permission, as seeded into the `permissions` table. */
export interface PermissionDefinition {
  code: PermissionCode;
  category: string;
  labelAr: string;
  labelEn: string;
  sortOrder: number;
}

/**
 * The catalogue with its bilingual labels.
 *
 * Written out rather than derived from the code strings because the Arabic is
 * not mechanically recoverable from `investigations.view`, and because these
 * labels are what a tenant administrator reads while deciding who may do what
 * — the one place in the system where a vague label has a security cost.
 */
const D = (
  code: PermissionCode,
  category: string,
  labelAr: string,
  labelEn: string,
): Omit<PermissionDefinition, 'sortOrder'> => ({
  code,
  category,
  labelAr,
  labelEn,
});

const RAW: Omit<PermissionDefinition, 'sortOrder'>[] = [
  // investigations
  D(
    P.INVESTIGATIONS_VIEW,
    'investigations',
    'عرض التحقيقات',
    'View investigations',
  ),
  D(
    P.INVESTIGATIONS_VIEW_ALL,
    'investigations',
    'عرض كل التحقيقات',
    'View all investigations',
  ),
  D(
    P.INVESTIGATIONS_CREATE,
    'investigations',
    'إنشاء تحقيق',
    'Create investigation',
  ),
  D(
    P.INVESTIGATIONS_EDIT,
    'investigations',
    'تعديل التحقيق',
    'Edit investigation',
  ),
  D(
    P.INVESTIGATIONS_DELETE,
    'investigations',
    'حذف التحقيق',
    'Delete investigation',
  ),
  D(
    P.INVESTIGATIONS_IMPORT,
    'investigations',
    'استيراد التحقيقات',
    'Import investigations',
  ),
  D(
    P.INVESTIGATIONS_ASSIGN,
    'investigations',
    'إسناد التحقيقات',
    'Assign investigations',
  ),
  D(
    P.INVESTIGATIONS_REASSIGN,
    'investigations',
    'إعادة الإسناد',
    'Reassign investigations',
  ),
  D(
    P.INVESTIGATIONS_CANCEL,
    'investigations',
    'إلغاء التحقيق',
    'Cancel investigation',
  ),
  D(
    P.INVESTIGATIONS_EXPORT,
    'investigations',
    'تصدير التحقيقات',
    'Export investigations',
  ),
  D(
    P.INVESTIGATIONS_ARCHIVE,
    'investigations',
    'أرشفة التحقيقات',
    'Archive investigations',
  ),
  D(
    P.INVESTIGATIONS_COMMENT,
    'investigations',
    'إضافة ملاحظات',
    'Comment on investigations',
  ),
  D(
    P.INVESTIGATIONS_OVERRIDE_STATUS,
    'investigations',
    'نقل استثنائي لحالة التحقيق',
    'Override case status',
  ),

  // customers
  D(P.CUSTOMERS_VIEW, 'customers', 'عرض العملاء', 'View customers'),
  D(P.CUSTOMERS_CREATE, 'customers', 'إنشاء عميل', 'Create customer'),
  D(P.CUSTOMERS_EDIT, 'customers', 'تعديل العميل', 'Edit customer'),
  D(P.CUSTOMERS_DELETE, 'customers', 'حذف العميل', 'Delete customer'),
  D(P.CUSTOMERS_MERGE, 'customers', 'دمج العملاء', 'Merge customers'),
  D(P.CUSTOMERS_EXPORT, 'customers', 'تصدير العملاء', 'Export customers'),

  // users
  D(P.USERS_VIEW, 'users', 'عرض المستخدمين', 'View users'),
  D(P.USERS_CREATE, 'users', 'إنشاء مستخدم', 'Create user'),
  D(P.USERS_EDIT, 'users', 'تعديل المستخدم', 'Edit user'),
  D(P.USERS_DISABLE, 'users', 'تعطيل/تفعيل المستخدم', 'Enable or disable user'),
  D(P.USERS_DELETE, 'users', 'حذف المستخدم', 'Delete user'),
  D(
    P.USERS_RESET_PASSWORD,
    'users',
    'إعادة تعيين كلمة المرور',
    'Reset password',
  ),
  D(P.USERS_MANAGE_SESSIONS, 'users', 'إدارة الجلسات', 'Manage sessions'),
  D(P.USERS_VIEW_ACTIVITY, 'users', 'عرض نشاط الدخول', 'View login activity'),

  // roles
  D(P.ROLES_VIEW, 'roles', 'عرض الأدوار', 'View roles'),
  D(P.ROLES_CREATE, 'roles', 'إنشاء دور', 'Create role'),
  D(P.ROLES_EDIT, 'roles', 'تعديل الدور', 'Edit role'),
  D(P.ROLES_DELETE, 'roles', 'حذف الدور', 'Delete role'),
  D(P.PERMISSIONS_ASSIGN, 'roles', 'إسناد الصلاحيات', 'Assign permissions'),

  // investigators
  D(
    P.INVESTIGATORS_VIEW,
    'investigators',
    'عرض الباحثين الميدانيين',
    'View field investigators',
  ),
  D(
    P.INVESTIGATORS_CREATE,
    'investigators',
    'إنشاء باحث ميداني',
    'Create field investigator',
  ),
  D(
    P.INVESTIGATORS_EDIT,
    'investigators',
    'تعديل الباحث الميداني',
    'Edit field investigator',
  ),
  D(
    P.INVESTIGATORS_DISABLE,
    'investigators',
    'تعطيل/تفعيل الباحث',
    'Enable or disable investigator',
  ),
  D(
    P.INVESTIGATORS_DELETE,
    'investigators',
    'حذف الباحث الميداني',
    'Delete field investigator',
  ),
  D(
    P.INVESTIGATORS_RESET_PASSWORD,
    'investigators',
    'إعادة تعيين كلمة مرور الباحث',
    'Reset investigator password',
  ),
  D(
    P.INVESTIGATORS_VIEW_PERFORMANCE,
    'investigators',
    'عرض الأداء',
    'View performance',
  ),
  D(
    P.INVESTIGATORS_VIEW_LOCATION,
    'investigators',
    'عرض المواقع الحية',
    'View live locations',
  ),

  // imports
  D(P.IMPORTS_VIEW, 'imports', 'عرض عمليات الاستيراد', 'View imports'),
  D(P.IMPORTS_CREATE, 'imports', 'رفع ملف استيراد', 'Upload import file'),
  D(P.IMPORTS_CONFIRM, 'imports', 'تأكيد الاستيراد', 'Confirm import'),
  D(P.IMPORTS_CANCEL, 'imports', 'إلغاء الاستيراد', 'Cancel import'),
  D(
    P.IMPORTS_MANAGE_MAPPINGS,
    'imports',
    'إدارة قوالب الربط',
    'Manage mapping templates',
  ),
  D(
    P.IMPORTS_RESOLVE_DUPLICATES,
    'imports',
    'معالجة التكرارات',
    'Resolve duplicates',
  ),

  // qc
  D(P.QC_VIEW, 'qc', 'عرض مراجعة الجودة', 'View quality control'),
  D(P.QC_APPROVE, 'qc', 'اعتماد التحقيق', 'Approve investigation'),
  D(P.QC_REJECT, 'qc', 'رفض التحقيق', 'Reject investigation'),
  D(P.QC_REWORK, 'qc', 'طلب إعادة العمل', 'Request rework'),
  D(P.QC_MANAGE_REASONS, 'qc', 'إدارة أسباب الرفض', 'Manage rejection reasons'),

  // reports
  D(P.REPORTS_VIEW, 'reports', 'عرض التقارير', 'View reports'),
  D(P.REPORTS_GENERATE, 'reports', 'إنشاء تقرير', 'Generate report'),
  D(P.REPORTS_DOWNLOAD, 'reports', 'تحميل التقارير', 'Download reports'),
  D(P.REPORTS_EXPORT, 'reports', 'تصدير البيانات', 'Export data'),
  D(
    P.REPORTS_MANAGE_TEMPLATES,
    'reports',
    'إدارة قوالب التقارير',
    'Manage report templates',
  ),

  // media
  D(P.MEDIA_VIEW, 'media', 'عرض المرفقات', 'View media'),
  D(P.MEDIA_UPLOAD, 'media', 'رفع المرفقات', 'Upload media'),
  D(P.MEDIA_DELETE, 'media', 'حذف المرفقات', 'Delete media'),
  D(P.MEDIA_DOWNLOAD, 'media', 'تحميل المرفقات', 'Download media'),

  // forms
  D(P.FORMS_VIEW, 'forms', 'عرض النماذج', 'View forms'),
  D(P.FORMS_CREATE, 'forms', 'إنشاء نموذج', 'Create form'),
  D(P.FORMS_EDIT, 'forms', 'تعديل النموذج', 'Edit form'),
  D(P.FORMS_PUBLISH, 'forms', 'نشر النموذج', 'Publish form'),
  D(P.FORMS_DELETE, 'forms', 'حذف النموذج', 'Delete form'),

  // catalogue
  D(P.PRODUCTS_VIEW, 'catalog', 'عرض المنتجات', 'View products'),
  D(P.PRODUCTS_MANAGE, 'catalog', 'إدارة المنتجات', 'Manage products'),
  D(
    P.INVESTIGATION_TYPES_VIEW,
    'catalog',
    'عرض أنواع التحقيق',
    'View investigation types',
  ),
  D(
    P.INVESTIGATION_TYPES_MANAGE,
    'catalog',
    'إدارة أنواع التحقيق',
    'Manage investigation types',
  ),

  // sla
  D(P.SLA_VIEW, 'sla', 'عرض اتفاقيات مستوى الخدمة', 'View SLA policies'),
  D(P.SLA_MANAGE, 'sla', 'إدارة اتفاقيات مستوى الخدمة', 'Manage SLA policies'),

  // dashboard
  D(P.DASHBOARD_VIEW, 'dashboard', 'عرض لوحة التحكم', 'View dashboard'),
  D(P.ANALYTICS_VIEW, 'dashboard', 'عرض التحليلات', 'View analytics'),
  D(
    P.ANALYTICS_VIEW_ALL,
    'dashboard',
    'عرض تحليلات الشركة كاملة',
    'View tenant-wide analytics',
  ),

  // audit
  D(P.AUDIT_VIEW, 'audit', 'عرض سجل التدقيق', 'View audit trail'),

  // settings
  D(P.SETTINGS_VIEW, 'settings', 'عرض الإعدادات', 'View settings'),
  D(P.SETTINGS_MANAGE, 'settings', 'إدارة الإعدادات', 'Manage settings'),
  D(
    P.TENANT_MANAGE,
    'settings',
    'إدارة بيانات الشركة',
    'Manage company profile',
  ),

  // clients
  D(P.CLIENTS_VIEW, 'clients', 'عرض الجهات', 'View clients'),
  D(
    P.CLIENTS_MANAGE,
    'clients',
    'إدارة الجهات وقوالبها',
    'Manage clients and their templates',
  ),

  // notifications
  D(
    P.NOTIFICATIONS_VIEW,
    'notifications',
    'عرض الإشعارات',
    'View notifications',
  ),
  D(
    P.NOTIFICATIONS_BROADCAST,
    'notifications',
    'إرسال إشعار عام',
    'Broadcast notification',
  ),

  // attendance and announcements
  D(
    P.ATTENDANCE_VIEW_ALL,
    'attendance',
    'عرض حضور الموظفين',
    'View staff attendance',
  ),
  D(
    P.ANNOUNCEMENTS_MANAGE,
    'announcements',
    'إدارة الإعلانات',
    'Manage announcements',
  ),
];

/** The catalogue, with display order assigned from declaration order. */
export const PERMISSION_CATALOG: PermissionDefinition[] = RAW.map(
  (definition, index) => ({ ...definition, sortOrder: index }),
);

export const ALL_PERMISSION_CODES: PermissionCode[] = PERMISSION_CATALOG.map(
  (p) => p.code,
);

const CODE_SET = new Set<string>(ALL_PERMISSION_CODES);

/**
 * Whether a string is a permission this build understands.
 *
 * Used when a role's grants are saved: a code that is not in the catalogue is
 * rejected rather than stored, so the permissions table can never accumulate
 * strings that no guard will ever check.
 */
export const isKnownPermission = (code: string): code is PermissionCode =>
  CODE_SET.has(code);

/** Distinct categories, in first-appearance order — the matrix UI's grouping. */
export const PERMISSION_CATEGORIES: string[] = [
  ...new Set(PERMISSION_CATALOG.map((p) => p.category)),
];

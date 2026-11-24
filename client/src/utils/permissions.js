/**
 * Permission codes, mirrored from the server's catalogue.
 *
 * A constant rather than a string literal at every call site, for the same
 * reason the server does it: a typo in `can('investigations.asign')` silently
 * hides a button forever, and nobody notices until a coordinator asks why they
 * cannot assign work.
 *
 * These must match `server/src/common/constants/permissions.ts`. The server is
 * authoritative — `GET /api/v1/permissions` serves the live catalogue, and the
 * roles screen renders from that rather than from this file. This exists only
 * so component code has something to reference by name.
 */
export const P = {
  INVESTIGATIONS_VIEW: 'investigations.view',
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
  INVESTIGATIONS_OVERRIDE_STATUS: 'investigations.override_status',

  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_EDIT: 'customers.edit',
  CUSTOMERS_DELETE: 'customers.delete',
  CUSTOMERS_MERGE: 'customers.merge',
  CUSTOMERS_EXPORT: 'customers.export',

  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_EDIT: 'users.edit',
  USERS_DISABLE: 'users.disable',
  USERS_DELETE: 'users.delete',
  USERS_RESET_PASSWORD: 'users.reset_password',
  USERS_MANAGE_SESSIONS: 'users.manage_sessions',
  USERS_VIEW_ACTIVITY: 'users.view_activity',

  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_EDIT: 'roles.edit',
  ROLES_DELETE: 'roles.delete',
  PERMISSIONS_ASSIGN: 'permissions.assign',

  INVESTIGATORS_VIEW: 'investigators.view',
  INVESTIGATORS_CREATE: 'investigators.create',
  INVESTIGATORS_EDIT: 'investigators.edit',
  INVESTIGATORS_DISABLE: 'investigators.disable',
  INVESTIGATORS_DELETE: 'investigators.delete',
  INVESTIGATORS_RESET_PASSWORD: 'investigators.reset_password',
  INVESTIGATORS_VIEW_PERFORMANCE: 'investigators.view_performance',
  INVESTIGATORS_VIEW_LOCATION: 'investigators.view_location',

  IMPORTS_VIEW: 'imports.view',
  IMPORTS_CREATE: 'imports.create',
  IMPORTS_CONFIRM: 'imports.confirm',
  IMPORTS_CANCEL: 'imports.cancel',
  IMPORTS_MANAGE_MAPPINGS: 'imports.manage_mappings',
  IMPORTS_RESOLVE_DUPLICATES: 'imports.resolve_duplicates',

  QC_VIEW: 'qc.view',
  QC_APPROVE: 'qc.approve',
  QC_REJECT: 'qc.reject',
  QC_REWORK: 'qc.rework',
  QC_MANAGE_REASONS: 'qc.manage_reasons',

  REPORTS_VIEW: 'reports.view',
  REPORTS_GENERATE: 'reports.generate',
  REPORTS_DOWNLOAD: 'reports.download',
  REPORTS_EXPORT: 'reports.export',
  REPORTS_MANAGE_TEMPLATES: 'reports.manage_templates',

  MEDIA_VIEW: 'media.view',
  MEDIA_UPLOAD: 'media.upload',
  MEDIA_DELETE: 'media.delete',
  MEDIA_DOWNLOAD: 'media.download',

  FORMS_VIEW: 'forms.view',
  FORMS_CREATE: 'forms.create',
  FORMS_EDIT: 'forms.edit',
  FORMS_PUBLISH: 'forms.publish',
  FORMS_DELETE: 'forms.delete',

  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_MANAGE: 'products.manage',
  INVESTIGATION_TYPES_VIEW: 'investigation_types.view',
  INVESTIGATION_TYPES_MANAGE: 'investigation_types.manage',

  SLA_VIEW: 'sla.view',
  SLA_MANAGE: 'sla.manage',

  DASHBOARD_VIEW: 'dashboard.view',
  ANALYTICS_VIEW: 'analytics.view',
  ANALYTICS_VIEW_ALL: 'analytics.view_all',

  AUDIT_VIEW: 'audit.view',

  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  TENANT_MANAGE: 'tenant.manage',

  CLIENTS_VIEW: 'clients.view',
  CLIENTS_MANAGE: 'clients.manage',

  NOTIFICATIONS_VIEW: 'notifications.view',
  NOTIFICATIONS_BROADCAST: 'notifications.broadcast',

  ATTENDANCE_VIEW_ALL: 'attendance.view_all',
  ANNOUNCEMENTS_MANAGE: 'announcements.manage',
};

import { P, PermissionCode, ALL_PERMISSION_CODES } from './permissions';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The roles a new tenant starts with.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  These are DEFAULTS, not the authorization model. Nothing in the codebase
 *  asks "is this user a COORDINATOR" — every check is against a permission, and
 *  every one of these grants is editable from the Roles screen. A tenant whose
 *  supervisors also do QC changes the supervisor role's grants; they do not
 *  need a code change, and they do not get told that supervisors cannot do QC
 *  because a constant somewhere says so.
 *
 *  `rank` is the one place a role is more than a bundle. It answers "who may
 *  act on whom": a user may only edit, disable, re-role or end the sessions of
 *  someone strictly below them. Equal rank does not grant control, which also
 *  stops an admin disabling a peer admin — or themselves — through the user
 *  management screen.
 */

export interface SystemRoleDefinition {
  code: string;
  nameAr: string;
  nameEn: string;
  description: string;
  rank: number;
  /** `'*'` means every permission in the catalogue. */
  permissions: PermissionCode[] | '*';
}

export const SYSTEM_ROLE_CODES = {
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  COORDINATOR: 'COORDINATOR',
  QC_OFFICER: 'QC_OFFICER',
  REPORT_USER: 'REPORT_USER',
  CLIENT_USER: 'CLIENT_USER',
} as const;

/** Read-only access to one's own work. The floor every role builds on. */
const BASE: PermissionCode[] = [P.DASHBOARD_VIEW, P.NOTIFICATIONS_VIEW];

const COORDINATOR_PERMISSIONS: PermissionCode[] = [
  ...BASE,
  // The coordinator is the main operational user: they receive imported work,
  // check it, and decide who goes where.
  P.INVESTIGATIONS_VIEW,
  P.INVESTIGATIONS_VIEW_ALL,
  P.INVESTIGATIONS_CREATE,
  P.INVESTIGATIONS_EDIT,
  P.INVESTIGATIONS_ASSIGN,
  P.INVESTIGATIONS_REASSIGN,
  P.INVESTIGATIONS_CANCEL,
  P.INVESTIGATIONS_EXPORT,
  P.INVESTIGATIONS_COMMENT,
  P.INVESTIGATIONS_IMPORT,
  P.CUSTOMERS_VIEW,
  P.CUSTOMERS_CREATE,
  P.CUSTOMERS_EDIT,
  P.IMPORTS_VIEW,
  P.IMPORTS_CREATE,
  P.IMPORTS_CONFIRM,
  P.IMPORTS_CANCEL,
  P.IMPORTS_MANAGE_MAPPINGS,
  P.IMPORTS_RESOLVE_DUPLICATES,
  P.INVESTIGATORS_VIEW,
  P.INVESTIGATORS_VIEW_PERFORMANCE,
  P.INVESTIGATORS_VIEW_LOCATION,
  P.MEDIA_VIEW,
  P.MEDIA_DOWNLOAD,
  P.REPORTS_VIEW,
  P.REPORTS_GENERATE,
  P.REPORTS_DOWNLOAD,
  P.REPORTS_EXPORT,
  P.PRODUCTS_VIEW,
  P.INVESTIGATION_TYPES_VIEW,
  P.FORMS_VIEW,
  P.SLA_VIEW,
  P.ANALYTICS_VIEW,
  // Deliberately absent: QC decisions. The person who assigned the work is not
  // the person who should sign off on it — that separation is the whole point
  // of having a QC step, and a tenant that disagrees can grant it.
];

const SUPERVISOR_PERMISSIONS: PermissionCode[] = [
  ...COORDINATOR_PERMISSIONS,
  P.INVESTIGATIONS_ARCHIVE,
  P.INVESTIGATORS_CREATE,
  P.INVESTIGATORS_EDIT,
  P.INVESTIGATORS_DISABLE,
  P.INVESTIGATORS_RESET_PASSWORD,
  P.USERS_VIEW,
  P.USERS_VIEW_ACTIVITY,
  P.QC_VIEW,
  P.ANALYTICS_VIEW_ALL,
  P.AUDIT_VIEW,
  P.CUSTOMERS_EXPORT,
  P.SLA_VIEW,
];

const QC_PERMISSIONS: PermissionCode[] = [
  ...BASE,
  // QC reads everything about a case and judges it. It cannot assign work,
  // cannot edit the case, and cannot delete evidence — a reviewer who can
  // change what they are reviewing is not a control.
  P.INVESTIGATIONS_VIEW,
  P.INVESTIGATIONS_VIEW_ALL,
  P.INVESTIGATIONS_COMMENT,
  P.CUSTOMERS_VIEW,
  P.MEDIA_VIEW,
  P.MEDIA_DOWNLOAD,
  P.QC_VIEW,
  P.QC_APPROVE,
  P.QC_REJECT,
  P.QC_REWORK,
  P.REPORTS_VIEW,
  P.REPORTS_DOWNLOAD,
  P.FORMS_VIEW,
  P.ANALYTICS_VIEW,
];

const REPORT_USER_PERMISSIONS: PermissionCode[] = [
  ...BASE,
  P.INVESTIGATIONS_VIEW,
  P.INVESTIGATIONS_VIEW_ALL,
  P.INVESTIGATIONS_EXPORT,
  P.CUSTOMERS_VIEW,
  P.REPORTS_VIEW,
  P.REPORTS_DOWNLOAD,
  P.REPORTS_EXPORT,
  P.ANALYTICS_VIEW,
  P.ANALYTICS_VIEW_ALL,
];

const CLIENT_USER_PERMISSIONS: PermissionCode[] = [
  // The narrowest role in the system, and the groundwork for the future client
  // portal: see your own submitted work and take the report away. No media
  // deletion, no assignment, no sight of the investigator who did the visit.
  P.DASHBOARD_VIEW,
  P.NOTIFICATIONS_VIEW,
  P.INVESTIGATIONS_VIEW,
  P.INVESTIGATIONS_CREATE,
  P.CUSTOMERS_VIEW,
  P.REPORTS_VIEW,
  P.REPORTS_DOWNLOAD,
];

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    code: SYSTEM_ROLE_CODES.COMPANY_ADMIN,
    nameAr: 'مدير الشركة',
    nameEn: 'Company Admin',
    description: 'Full administrative control of one tenant.',
    rank: 100,
    permissions: '*',
  },
  {
    code: SYSTEM_ROLE_CODES.SUPERVISOR,
    nameAr: 'مشرف',
    nameEn: 'Supervisor',
    description: 'Oversees coordinators and field investigators.',
    rank: 70,
    permissions: SUPERVISOR_PERMISSIONS,
  },
  {
    code: SYSTEM_ROLE_CODES.COORDINATOR,
    nameAr: 'منسق العمليات',
    nameEn: 'Coordinator',
    description: 'Runs daily case operations and assignment.',
    rank: 50,
    permissions: COORDINATOR_PERMISSIONS,
  },
  {
    code: SYSTEM_ROLE_CODES.QC_OFFICER,
    nameAr: 'مسؤول الجودة',
    nameEn: 'QC Officer',
    description: 'Reviews submitted investigations.',
    rank: 50,
    permissions: QC_PERMISSIONS,
  },
  {
    code: SYSTEM_ROLE_CODES.REPORT_USER,
    nameAr: 'مستخدم التقارير',
    nameEn: 'Report User',
    description: 'Read-only access to reports and analytics.',
    rank: 20,
    permissions: REPORT_USER_PERMISSIONS,
  },
  {
    code: SYSTEM_ROLE_CODES.CLIENT_USER,
    nameAr: 'مستخدم عميل',
    nameEn: 'Client User',
    description: 'External client with portal access to their own cases.',
    rank: 10,
    permissions: CLIENT_USER_PERMISSIONS,
  },
];

/** Resolve a definition's grants, expanding the `'*'` shorthand. */
export function permissionsFor(role: SystemRoleDefinition): PermissionCode[] {
  return role.permissions === '*'
    ? [...ALL_PERMISSION_CODES]
    : [...new Set(role.permissions)];
}

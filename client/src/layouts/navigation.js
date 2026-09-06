import { P } from '../utils/permissions';

/**
 * The navigation tree, as data.
 *
 * Each item names the permissions that reveal it. `AppLayout` filters the whole
 * tree through `can()`, so a user never sees a link to a screen that would
 * refuse them — and a section whose every child is hidden disappears rather
 * than leaving an empty heading.
 *
 * Written as data rather than JSX so the same structure can drive the sidebar,
 * the mobile drawer and the command palette without three copies of the list
 * drifting apart.
 *
 * The shape follows the brief's coordinator navigation: Operations, then
 * Assignments, Customers, Field Investigators, Imports, Quality Control,
 * Reports, and Administration last.
 */
export const NAVIGATION = [
  {
    key: 'dashboard',
    to: '/',
    icon: 'speedometer2',
    labelKey: 'nav.dashboard',
    permissions: [P.DASHBOARD_VIEW],
    end: true,
  },

  {
    key: 'operations',
    labelKey: 'nav.operations',
    icon: 'folder2-open',
    permissions: [P.INVESTIGATIONS_VIEW],
    children: [
      {
        key: 'cases-all',
        to: '/investigations',
        labelKey: 'nav.allCases',
        permissions: [P.INVESTIGATIONS_VIEW],
        end: true,
      },
      {
        key: 'cases-new',
        to: '/investigations?statusGroup=NEW',
        labelKey: 'nav.newCases',
        permissions: [P.INVESTIGATIONS_VIEW],
        countKey: 'NEW',
      },
      {
        key: 'cases-unassigned',
        to: '/investigations?statusGroup=UNASSIGNED',
        labelKey: 'nav.unassigned',
        permissions: [P.INVESTIGATIONS_VIEW],
        countKey: 'UNASSIGNED',
      },
      {
        key: 'cases-assigned',
        to: '/investigations?statusGroup=ASSIGNED',
        labelKey: 'nav.assigned',
        permissions: [P.INVESTIGATIONS_VIEW],
        countKey: 'ASSIGNED',
      },
      {
        key: 'cases-progress',
        to: '/investigations?statusGroup=IN_PROGRESS',
        labelKey: 'nav.inProgress',
        permissions: [P.INVESTIGATIONS_VIEW],
        countKey: 'IN_PROGRESS',
      },
      {
        key: 'cases-submitted',
        to: '/investigations?statusGroup=SUBMITTED',
        labelKey: 'nav.submitted',
        permissions: [P.INVESTIGATIONS_VIEW],
        countKey: 'SUBMITTED',
      },
      {
        key: 'cases-rework',
        to: '/investigations?statusGroup=REWORK',
        labelKey: 'nav.rework',
        permissions: [P.INVESTIGATIONS_VIEW],
        countKey: 'REWORK',
      },
      {
        key: 'cases-completed',
        to: '/investigations?statusGroup=COMPLETED',
        labelKey: 'nav.completed',
        permissions: [P.INVESTIGATIONS_VIEW],
        countKey: 'COMPLETED',
      },
      {
        key: 'cases-overdue',
        to: '/investigations?overdue=true',
        labelKey: 'nav.overdue',
        permissions: [P.INVESTIGATIONS_VIEW],
        countKey: 'overdue',
        tone: 'danger',
      },
    ],
  },

  {
    key: 'assignments',
    labelKey: 'nav.assignments',
    icon: 'diagram-3',
    permissions: [P.INVESTIGATIONS_ASSIGN, P.INVESTIGATIONS_REASSIGN],
    children: [
      {
        key: 'assign',
        to: '/assignments',
        labelKey: 'nav.assignCases',
        permissions: [P.INVESTIGATIONS_ASSIGN],
        end: true,
      },
    ],
  },

  {
    key: 'customers',
    to: '/customers',
    icon: 'people',
    labelKey: 'nav.customers',
    permissions: [P.CUSTOMERS_VIEW],
  },

  {
    key: 'investigators',
    labelKey: 'nav.investigators',
    icon: 'person-badge',
    permissions: [P.INVESTIGATORS_VIEW],
    children: [
      {
        key: 'investigators-list',
        to: '/investigators',
        labelKey: 'nav.investigators',
        permissions: [P.INVESTIGATORS_VIEW],
        end: true,
      },
      {
        key: 'investigators-map',
        to: '/investigators/map',
        labelKey: 'nav.liveMap',
        permissions: [P.INVESTIGATORS_VIEW_LOCATION],
      },
    ],
  },

  {
    key: 'imports',
    labelKey: 'nav.imports',
    icon: 'file-earmark-spreadsheet',
    permissions: [P.IMPORTS_VIEW],
    children: [
      {
        key: 'import-new',
        to: '/imports/new',
        labelKey: 'nav.excelImport',
        permissions: [P.IMPORTS_CREATE],
      },
      {
        key: 'import-history',
        to: '/imports',
        labelKey: 'nav.importHistory',
        permissions: [P.IMPORTS_VIEW],
        end: true,
      },
    ],
  },

  {
    key: 'qc',
    labelKey: 'nav.qualityControl',
    icon: 'patch-check',
    permissions: [P.QC_VIEW],
    children: [
      {
        key: 'qc-queue',
        to: '/qc',
        labelKey: 'nav.pendingQc',
        permissions: [P.QC_VIEW],
        end: true,
        countKey: 'QC',
      },
      {
        key: 'qc-stats',
        to: '/qc/statistics',
        labelKey: 'nav.analytics',
        permissions: [P.QC_VIEW],
      },
    ],
  },

  {
    key: 'reports',
    to: '/reports',
    icon: 'file-earmark-pdf',
    labelKey: 'nav.reports',
    permissions: [P.REPORTS_VIEW],
  },

  {
    key: 'administration',
    labelKey: 'nav.administration',
    icon: 'gear',
    permissions: [
      P.USERS_VIEW,
      P.ROLES_VIEW,
      P.PRODUCTS_VIEW,
      P.INVESTIGATION_TYPES_VIEW,
      P.FORMS_VIEW,
      P.SLA_VIEW,
      P.SETTINGS_VIEW,
      P.AUDIT_VIEW,
    ],
    children: [
      {
        key: 'users',
        to: '/admin/users',
        labelKey: 'nav.users',
        permissions: [P.USERS_VIEW],
      },
      {
        key: 'roles',
        to: '/admin/roles',
        labelKey: 'nav.roles',
        permissions: [P.ROLES_VIEW],
      },
      {
        key: 'products',
        to: '/admin/products',
        labelKey: 'nav.products',
        permissions: [P.PRODUCTS_VIEW],
      },
      {
        key: 'types',
        to: '/admin/investigation-types',
        labelKey: 'nav.investigationTypes',
        permissions: [P.INVESTIGATION_TYPES_VIEW],
      },
      {
        key: 'forms',
        to: '/admin/forms',
        labelKey: 'nav.forms',
        permissions: [P.FORMS_VIEW],
      },
      {
        key: 'sla',
        to: '/admin/sla',
        labelKey: 'nav.sla',
        permissions: [P.SLA_VIEW],
      },
      {
        key: 'settings',
        to: '/admin/settings',
        labelKey: 'nav.settings',
        permissions: [P.SETTINGS_VIEW, P.TENANT_MANAGE],
      },
      {
        key: 'audit',
        to: '/admin/audit',
        labelKey: 'nav.audit',
        permissions: [P.AUDIT_VIEW],
      },
    ],
  },

  /**
   * The platform operator's own section, and the only one gated on something
   * other than a permission.
   *
   * `permissions: []` would be wrong twice over: `can()` returns true for every
   * permission a super admin asks about, so any permission at all would also
   * reveal this to a company administrator who was granted it. `superAdminOnly`
   * is checked against the principal instead — matching the server, which gates
   * `/tenants` on `isSuperAdmin` in code for exactly this reason.
   */
  {
    key: 'platform',
    labelKey: 'nav.platform',
    icon: 'buildings',
    superAdminOnly: true,
    permissions: [],
    children: [
      {
        key: 'platform-tenants',
        to: '/platform/tenants',
        labelKey: 'nav.tenants',
        permissions: [],
      },
    ],
  },
];

/**
 * Prune the tree to what this user may reach.
 *
 * A section survives only if at least one of its children does — an
 * "Administration" heading with nothing under it is worse than no heading,
 * because it looks like something failed to load.
 *
 * `isSuperAdmin` is passed in rather than inferred from `can()`, which cannot
 * distinguish the two: it answers true for every permission a super admin is
 * asked about, so an entry marked `superAdminOnly` would survive for anybody
 * holding whatever permission it happened to list.
 *
 * As ever, this only decides what is drawn. The server decides what is allowed.
 */
export function visibleNavigation(can, { isSuperAdmin = false } = {}) {
  return NAVIGATION.map((item) => {
    if (item.superAdminOnly && !isSuperAdmin) return null;

    if (!item.children) {
      return can(...item.permissions) ? item : null;
    }

    // A section that is already established as the operator's keeps all its
    // children; they carry no permissions of their own to filter on.
    const children = item.superAdminOnly
      ? item.children
      : item.children.filter((child) => can(...child.permissions));

    return children.length > 0 ? { ...item, children } : null;
  }).filter(Boolean);
}

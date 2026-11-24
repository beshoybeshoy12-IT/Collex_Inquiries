import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';
import AppLayout from '../layouts/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import { P } from '../utils/permissions';

// Login is eagerly imported: it is the first paint for every signed-out user,
// and a lazy chunk there means a spinner before the very first screen.
import Login from '../modules/auth/Login';

/**
 * Every other page is a separate chunk.
 *
 * React Router renders one of these at a time, so loading them all up front
 * means a coordinator on a phone downloads the form builder, the QC packet and
 * the chart library to look at a case list.
 */
const Home = lazy(() => import('../modules/home/Home'));
const Dashboard = lazy(() => import('../modules/dashboard/Dashboard'));
const InvestigationList = lazy(() => import('../modules/investigations/InvestigationList'));
const InvestigationDetail = lazy(() => import('../modules/investigations/InvestigationDetail'));
const CustomerList = lazy(() => import('../modules/customers/CustomerList'));
const CustomerDetail = lazy(() => import('../modules/customers/CustomerDetail'));
const AssignmentBoard = lazy(() => import('../modules/assignments/AssignmentBoard'));
const InvestigatorList = lazy(() => import('../modules/investigators/InvestigatorList'));
const InvestigatorDetail = lazy(() => import('../modules/investigators/InvestigatorDetail'));
const LiveMap = lazy(() => import('../modules/investigators/LiveMap'));
const ImportWizard = lazy(() => import('../modules/imports/ImportWizard'));
const ImportHistory = lazy(() => import('../modules/imports/ImportHistory'));
const ImportBatchDetail = lazy(() => import('../modules/imports/ImportBatchDetail'));
const ClientList = lazy(() => import('../modules/clients/ClientList'));
const ClientEditor = lazy(() => import('../modules/clients/ClientEditor'));
const ClientImport = lazy(() => import('../modules/clients/ClientImport'));
const QcQueue = lazy(() => import('../modules/qc/QcQueue'));
const QcReview = lazy(() => import('../modules/qc/QcReview'));
const QcStatistics = lazy(() => import('../modules/qc/QcStatistics'));
const ReportList = lazy(() => import('../modules/reports/ReportList'));
const UserList = lazy(() => import('../modules/users/UserList'));
const RoleList = lazy(() => import('../modules/roles/RoleList'));
const ProductList = lazy(() => import('../modules/catalog/ProductList'));
const InvestigationTypeList = lazy(() => import('../modules/catalog/InvestigationTypeList'));
const FormList = lazy(() => import('../modules/forms/FormList'));
const FormBuilder = lazy(() => import('../modules/forms/FormBuilder'));
const PrintCaseSheet = lazy(() =>
  import('../modules/forms/PrintSheet').then((m) => ({ default: m.PrintCaseSheet })),
);
const PrintBlankForm = lazy(() =>
  import('../modules/forms/PrintSheet').then((m) => ({ default: m.PrintBlankForm })),
);
const SlaSettings = lazy(() => import('../modules/sla/SlaSettings'));
const CompanySettings = lazy(() => import('../modules/settings/CompanySettings'));
const AuditLog = lazy(() => import('../modules/audit/AuditLog'));
const PlatformTenantList = lazy(() => import('../modules/platform/TenantList'));
const Notifications = lazy(() => import('../modules/notifications/Notifications'));
const Profile = lazy(() => import('../modules/auth/Profile'));
const NotFound = lazy(() => import('../modules/misc/NotFound'));

/** Shown while a route's chunk downloads. Deliberately minimal. */
function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="d-flex justify-content-center align-items-center py-5">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">{t('app.loading')}</span>
      </div>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, booting } = useAuth();

  // Resolving the principal has to finish before routing decides anything, or
  // a reload on a deep link bounces to the login screen and back.
  if (booting) {
    return (
      <div className="d-flex vh-100 justify-content-center align-items-center">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />

        {/* Printable sheets sit outside the layout so only the paper prints. */}
        <Route
          path="print/investigation/:id"
          element={
            <ProtectedRoute permissions={[P.INVESTIGATIONS_VIEW]}>
              <PrintCaseSheet />
            </ProtectedRoute>
          }
        />
        <Route
          path="print/form/:id"
          element={
            <ProtectedRoute permissions={[P.FORMS_VIEW]}>
              <PrintBlankForm />
            </ProtectedRoute>
          }
        />

        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route
            path="dashboard"
            element={
              <ProtectedRoute permissions={[P.DASHBOARD_VIEW]}>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="investigations"
            element={
              <ProtectedRoute permissions={[P.INVESTIGATIONS_VIEW]}>
                <InvestigationList />
              </ProtectedRoute>
            }
          />
          <Route
            path="investigations/:id"
            element={
              <ProtectedRoute permissions={[P.INVESTIGATIONS_VIEW]}>
                <InvestigationDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="customers"
            element={
              <ProtectedRoute permissions={[P.CUSTOMERS_VIEW]}>
                <CustomerList />
              </ProtectedRoute>
            }
          />
          <Route
            path="customers/:id"
            element={
              <ProtectedRoute permissions={[P.CUSTOMERS_VIEW]}>
                <CustomerDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="assignments"
            element={
              <ProtectedRoute permissions={[P.INVESTIGATIONS_ASSIGN]}>
                <AssignmentBoard />
              </ProtectedRoute>
            }
          />

          <Route
            path="investigators"
            element={
              <ProtectedRoute permissions={[P.INVESTIGATORS_VIEW]}>
                <InvestigatorList />
              </ProtectedRoute>
            }
          />
          <Route
            path="investigators/map"
            element={
              <ProtectedRoute permissions={[P.INVESTIGATORS_VIEW_LOCATION]}>
                <LiveMap />
              </ProtectedRoute>
            }
          />
          <Route
            path="investigators/:id"
            element={
              <ProtectedRoute permissions={[P.INVESTIGATORS_VIEW]}>
                <InvestigatorDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="clients"
            element={
              <ProtectedRoute permissions={[P.CLIENTS_VIEW]}>
                <ClientList />
              </ProtectedRoute>
            }
          />
          <Route
            path="clients/new"
            element={
              <ProtectedRoute permissions={[P.CLIENTS_MANAGE]}>
                <ClientEditor />
              </ProtectedRoute>
            }
          />
          <Route
            path="clients/:id"
            element={
              <ProtectedRoute permissions={[P.CLIENTS_VIEW]}>
                <ClientEditor />
              </ProtectedRoute>
            }
          />
          <Route
            path="clients/:id/import"
            element={
              <ProtectedRoute permissions={[P.IMPORTS_CREATE]}>
                <ClientImport />
              </ProtectedRoute>
            }
          />

          <Route
            path="imports"
            element={
              <ProtectedRoute permissions={[P.IMPORTS_VIEW]}>
                <ImportHistory />
              </ProtectedRoute>
            }
          />
          <Route
            path="imports/new"
            element={
              <ProtectedRoute permissions={[P.IMPORTS_CREATE]}>
                <ImportWizard />
              </ProtectedRoute>
            }
          />
          <Route
            path="imports/:id"
            element={
              <ProtectedRoute permissions={[P.IMPORTS_VIEW]}>
                <ImportBatchDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="qc"
            element={
              <ProtectedRoute permissions={[P.QC_VIEW]}>
                <QcQueue />
              </ProtectedRoute>
            }
          />
          <Route
            path="qc/statistics"
            element={
              <ProtectedRoute permissions={[P.QC_VIEW]}>
                <QcStatistics />
              </ProtectedRoute>
            }
          />
          <Route
            path="qc/:id"
            element={
              <ProtectedRoute permissions={[P.QC_VIEW]}>
                <QcReview />
              </ProtectedRoute>
            }
          />

          <Route
            path="reports"
            element={
              <ProtectedRoute permissions={[P.REPORTS_VIEW]}>
                <ReportList />
              </ProtectedRoute>
            }
          />

          <Route
            path="admin/users"
            element={
              <ProtectedRoute permissions={[P.USERS_VIEW]}>
                <UserList />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/roles"
            element={
              <ProtectedRoute permissions={[P.ROLES_VIEW]}>
                <RoleList />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/products"
            element={
              <ProtectedRoute permissions={[P.PRODUCTS_VIEW]}>
                <ProductList />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/investigation-types"
            element={
              <ProtectedRoute permissions={[P.INVESTIGATION_TYPES_VIEW]}>
                <InvestigationTypeList />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/forms"
            element={
              <ProtectedRoute permissions={[P.FORMS_VIEW]}>
                <FormList />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/forms/:id"
            element={
              <ProtectedRoute permissions={[P.FORMS_VIEW]}>
                <FormBuilder />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/sla"
            element={
              <ProtectedRoute permissions={[P.SLA_VIEW]}>
                <SlaSettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/settings"
            element={
              <ProtectedRoute permissions={[P.SETTINGS_VIEW, P.TENANT_MANAGE]}>
                <CompanySettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/audit"
            element={
              <ProtectedRoute permissions={[P.AUDIT_VIEW]}>
                <AuditLog />
              </ProtectedRoute>
            }
          />

          {/* The platform console. Not under `admin/` on purpose: everything
              there is a company administering itself, and this is the operator
              administering the companies. `superAdmin` rather than a permission
              — see ProtectedRoute. */}
          <Route
            path="platform/tenants"
            element={
              <ProtectedRoute superAdmin>
                <PlatformTenantList />
              </ProtectedRoute>
            }
          />

          <Route path="notifications" element={<Notifications />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import PageHeader, { Field, Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import {
  PriorityBadge,
  SlaBadge,
  StateBadge,
  StatusBadge,
} from '../../components/Badges';
import AssignModal from '../assignments/AssignModal';
import ClientLogo from '../clients/ClientLogo';
import { useCaseClient } from '../../hooks/useClients';
import CaseTimeline from './CaseTimeline';
import CaseEvidence from './CaseEvidence';
import CaseGps from './CaseGps';
import CaseAnswers from './CaseAnswers';
import CaseReports from './CaseReports';
import MoveCaseButton from './MoveCaseButton';
import CaseAudit from './CaseAudit';

const TABS = [
  'overview',
  'customer',
  'investigation',
  'photos',
  'gps',
  'timeline',
  'qc',
  'report',
  'audit',
];

/**
 * The case workspace.
 *
 * ONE PAGE WITH TABS, not nine pages. A coordinator on the phone to a customer
 * moves between the address, the photos and the timeline in seconds; separate
 * routes would mean a full load and a lost scroll position each time.
 *
 * The tab lives in the query string so a link to "this case, the GPS tab" is
 * shareable — which is exactly what somebody does when they want a colleague to
 * look at a specific problem.
 *
 * ALLOWED TRANSITIONS COME FROM THE SERVER. The action bar renders
 * `allowedTransitions`, which the state machine computed for this case and this
 * user, rather than a duplicate of those rules living here and drifting.
 */
export default function InvestigationDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';

  const [reassigning, setReassigning] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['investigation', id],
    queryFn: async () => (await api.get(`/investigations/${id}`)).data,
  });

  if (isLoading) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-4 d-block mb-3" style={{ height: 32 }} />
        <span className="placeholder col-12 d-block" style={{ height: 280 }} />
      </div>
    );
  }

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const setTab = (next) => {
    const updated = new URLSearchParams(params);
    updated.set('tab', next);
    setParams(updated, { replace: true });
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/investigations" className="small text-decoration-none">
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            {t('cases.title')}
          </Link>
        }
        title={
          <span className="d-flex align-items-center gap-2 flex-wrap">
            <span className="mono">{data.caseNumber}</span>
            <StatusBadge status={data.status} />
            <PriorityBadge priority={data.priority} />
            <SlaBadge sla={data.sla} />
          </span>
        }
        subtitle={
          <>
            {data.customer?.fullName}
            {data.applicationNumber && (
              <span className="ms-2 mono">{data.applicationNumber}</span>
            )}
          </>
        }
        actions={
          <>
            {can(P.INVESTIGATIONS_ASSIGN) && !data.investigatorId && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setAssigning(true)}
              >
                <i className="bi bi-person-check me-1" aria-hidden="true" />
                {t('assignment.assign')}
              </button>
            )}

            {can(P.INVESTIGATIONS_REASSIGN) && data.investigatorId && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setReassigning(true)}
              >
                <i className="bi bi-arrow-left-right me-1" aria-hidden="true" />
                {t('assignment.reassign')}
              </button>
            )}

            <MoveCaseButton caseId={id} variant="primary" />
          </>
        }
      />

      <ul className="nav nav-tabs mb-3 flex-nowrap overflow-auto">
        {TABS.map((key) => (
          <li className="nav-item" key={key}>
            <button
              type="button"
              className={`nav-link text-nowrap ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {t(`cases.tabs.${key}`)}
            </button>
          </li>
        ))}
      </ul>

      {tab === 'overview' && <Overview investigation={data} language={i18n.language} />}
      {tab === 'customer' && <CustomerTab investigation={data} />}
      {tab === 'investigation' && <CaseAnswers investigationId={id} investigation={data} />}
      {tab === 'photos' && <CaseEvidence investigationId={id} status={data.status} />}
      {tab === 'gps' && <CaseGps investigationId={id} />}
      {tab === 'timeline' && <CaseTimeline investigationId={id} />}
      {tab === 'qc' && <QcTab investigation={data} />}
      {tab === 'report' && <CaseReports investigation={data} />}
      {tab === 'audit' && <CaseAudit investigationId={id} />}

      <AssignModal
        open={assigning}
        onClose={() => setAssigning(false)}
        investigationIds={[id]}
        onDone={() => queryClient.invalidateQueries({ queryKey: ['investigation', id] })}
      />

      <AssignModal
        open={reassigning}
        onClose={() => setReassigning(false)}
        investigationIds={[id]}
        mode="reassign"
        onDone={() => queryClient.invalidateQueries({ queryKey: ['investigation', id] })}
      />
    </>
  );
}

function Overview({ investigation, language }) {
  const { t } = useTranslation();

  return (
    <div className="row g-3">
      <div className="col-12 col-lg-8">
        <Panel title={t('cases.tabs.overview')} className="mb-3">
          <div className="row">
            {investigation.clientAccount && (
              <div className="col-12 mb-2">
                <CaseClient investigation={investigation} language={language} />
              </div>
            )}
            {investigation.additionalData?.extraFields?.length > 0 && (
              <div className="col-12 mb-2">
                <details className="case-extra">
                  <summary>
                    <i className="bi bi-file-earmark-spreadsheet me-1" aria-hidden="true" />
                    {t('cases.extraFields', {
                      count: investigation.additionalData.extraFields.length,
                    })}
                  </summary>
                  <dl className="case-client__fields">
                    {investigation.additionalData.extraFields.map((field) => (
                      <div key={field.key}>
                        <dt>{field.label}</dt>
                        <dd dir="auto">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </div>
            )}
            <div className="col-6 col-md-4">
              <Field label={t('cases.product')}>
                {localisedName(investigation.product, language)}
              </Field>
            </div>
            <div className="col-6 col-md-4">
              <Field label={t('cases.investigationType')}>
                {localisedName(investigation.investigationType, language)}
              </Field>
            </div>
            <div className="col-6 col-md-4">
              <Field label={t('cases.result')}>
                {investigation.result ? t(`result.${investigation.result}`) : null}
              </Field>
            </div>
            <div className="col-12">
              <Field label={t('cases.address')}>{investigation.addressLine}</Field>
            </div>
            <div className="col-6 col-md-4">
              <Field label={t('cases.governorate')}>
                {localisedName(investigation.governorate, language)}
              </Field>
            </div>
            <div className="col-6 col-md-4">
              <Field label={t('cases.city')}>
                {localisedName(investigation.city, language)}
              </Field>
            </div>
            <div className="col-6 col-md-4">
              <Field label={t('cases.district')}>
                {localisedName(investigation.district, language)}
              </Field>
            </div>
            {investigation.notes && (
              <div className="col-12">
                <Field label={t('common.notes')}>{investigation.notes}</Field>
              </div>
            )}
          </div>
        </Panel>

        <Panel title={t('dashboard.avgTat')}>
          <div className="row text-center">
            <TatCell label={t('dashboard.tatAssignment')} minutes={investigation.tat?.assignmentMinutes} />
            <TatCell label={t('dashboard.tatAcceptance')} minutes={investigation.tat?.acceptanceMinutes} />
            <TatCell label={t('dashboard.tatField')} minutes={investigation.tat?.investigationMinutes} />
            <TatCell label={t('dashboard.tatQc')} minutes={investigation.tat?.qcMinutes} />
            <TatCell label={t('dashboard.tatTotal')} minutes={investigation.tat?.totalMinutes} strong />
          </div>
        </Panel>
      </div>

      <div className="col-12 col-lg-4">
        <Panel title={t('assignment.title')} className="mb-3">
          <Field label={t('cases.investigator')}>
            {investigation.investigator ? (
              <Link
                to={`/investigators/${investigation.investigator.id}`}
                className="text-decoration-none"
              >
                {investigation.investigator.fullName}
                <span className="d-block small text-body-secondary mono">
                  {investigation.investigator.employeeCode} ·{' '}
                  {investigation.investigator.phone}
                </span>
              </Link>
            ) : null}
          </Field>
          <Field label={t('cases.coordinator')}>
            {investigation.coordinator?.fullName}
          </Field>
          <Field label={t('cases.dueAt')}>
            {investigation.dueAt
              ? new Date(investigation.dueAt).toLocaleString(language)
              : null}
          </Field>
        </Panel>

        <Panel title={t('common.details')}>
          <Field label={t('common.createdAt')}>
            {new Date(investigation.createdAt).toLocaleString(language)}
          </Field>
          {investigation.assignedAt && (
            <Field label={t('status.ASSIGNED')}>
              {new Date(investigation.assignedAt).toLocaleString(language)}
            </Field>
          )}
          {investigation.submittedAt && (
            <Field label={t('status.SUBMITTED')}>
              {new Date(investigation.submittedAt).toLocaleString(language)}
            </Field>
          )}
          {investigation.completedAt && (
            <Field label={t('status.COMPLETED')}>
              {new Date(investigation.completedAt).toLocaleString(language)}
            </Field>
          )}
          {investigation.reworkCount > 0 && (
            <Field label={t('cases.reworkCount')}>
              <span className="badge text-bg-warning">{investigation.reworkCount}</span>
            </Field>
          )}
          {investigation.importBatch && (
            <Field label={t('imports.batch')}>
              <Link to={`/imports/${investigation.importBatch.id}`} className="mono">
                {investigation.importBatch.reference}
              </Link>
            </Field>
          )}
        </Panel>
      </div>
    </div>
  );
}

function TatCell({ label, minutes, strong }) {
  const readable =
    minutes == null
      ? '—'
      : minutes < 60
        ? `${minutes}m`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h`
          : `${Math.floor(minutes / 1440)}d`;

  return (
    <div className="col">
      <div className={`fs-5 ${strong ? 'fw-semibold' : ''}`}>{readable}</div>
      <div className="small text-body-secondary">{label}</div>
    </div>
  );
}

function CustomerTab({ investigation }) {
  const { t, i18n } = useTranslation();
  const customer = investigation.customer;

  if (!customer) return <EmptyState title={t('common.empty')} />;

  return (
    <div className="row g-3">
      <div className="col-12 col-lg-6">
        <Panel
          title={t('customers.customer')}
          actions={
            <Link
              to={`/customers/${customer.id}`}
              className="btn btn-sm btn-outline-secondary py-0"
            >
              {t('customers.history')}
            </Link>
          }
        >
          <Field label={t('customers.fullName')}>{customer.fullName}</Field>
          <Field label={t('customers.nationalId')}>
            <span className="mono">{customer.nationalId}</span>
          </Field>
          <Field label={t('customers.mobile')}>
            <span className="mono">{customer.mobile}</span>
          </Field>
          <Field label={t('customers.altMobile')}>
            <span className="mono">{customer.altMobile}</span>
          </Field>
          <Field label={t('customers.homePhone')}>
            <span className="mono">{customer.homePhone}</span>
          </Field>
        </Panel>
      </div>

      <div className="col-12 col-lg-6">
        <Panel title={t('cases.tabs.residence')} className="mb-3">
          <Field label={t('customers.residenceAddress')}>
            {customer.residenceAddress}
          </Field>
          <Field label={t('cases.governorate')}>
            {localisedName(investigation.governorate, i18n.language)}
          </Field>
        </Panel>

        <Panel title={t('cases.tabs.workplace')}>
          <Field label={t('customers.workplaceName')}>{customer.workplaceName}</Field>
          <Field label={t('customers.jobTitle')}>{customer.jobTitle}</Field>
          <Field label={t('customers.workplaceAddress')}>
            {customer.workplaceAddress}
          </Field>
          <Field label={t('customers.workplacePhone')}>
            <span className="mono">{customer.workplacePhone}</span>
          </Field>
        </Panel>
      </div>
    </div>
  );
}

function QcTab({ investigation }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();

  const reviews = investigation.qcReviews ?? [];

  return (
    <>
      {can(P.QC_VIEW) &&
        ['QC_PENDING'].includes(investigation.status) && (
          <div className="alert alert-info d-flex justify-content-between align-items-center py-2">
            <span className="small">{t('qc.queue')}</span>
            <Link
              to={`/qc/${investigation.id}`}
              className="btn btn-sm btn-primary"
            >
              {t('qc.review')}
            </Link>
          </div>
        )}

      {reviews.length === 0 ? (
        <EmptyState title={t('qc.noPending')} icon="patch-check" />
      ) : (
        <div className="d-flex flex-column gap-2">
          {reviews.map((review) => (
            <Panel key={review.id}>
              <div className="d-flex justify-content-between align-items-start gap-2">
                <div>
                  <StateBadge value={review.decision} namespace="importRowStatus" />
                  <span className="ms-2 small text-body-secondary">
                    {t('qc.attempt', { n: review.attempt })}
                  </span>
                  {review.comment && <p className="mb-1 mt-2">{review.comment}</p>}
                  {review.reasons?.length > 0 && (
                    <div className="d-flex flex-wrap gap-1 mt-1">
                      {review.reasons.map((entry) => (
                        <span key={entry.reasonId} className="badge text-bg-light">
                          {localisedName(entry.reason, i18n.language)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-end small text-body-secondary flex-shrink-0">
                  <div>{review.reviewer?.fullName}</div>
                  <div>{new Date(review.reviewedAt).toLocaleString(i18n.language)}</div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The bank or company the case is for, with its logo, and the client's own
 * fields from its file ("Loan amount", "Branch") as they were imported.
 */
function CaseClient({ investigation, language }) {
  const { t } = useTranslation();
  const { client } = useCaseClient(investigation);
  const extra = investigation.additionalData?.clientFields ?? [];

  return (
    <div className="case-client">
      <Link to={`/clients/${investigation.clientAccount.id}`} className="case-client__head">
        <ClientLogo client={client} size={36} />
        <span>
          <span className="small text-body-secondary d-block">{t('clients.client')}</span>
          <span className="fw-semibold">{localisedName(investigation.clientAccount, language)}</span>
        </span>
      </Link>
      {extra.length > 0 && (
        <dl className="case-client__fields">
          {extra.map((field) => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd dir="auto">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

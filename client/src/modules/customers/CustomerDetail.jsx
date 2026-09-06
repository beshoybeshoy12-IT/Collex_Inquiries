import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { localisedName } from '../../i18n';
import PageHeader, { Field, Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { PriorityBadge, StatusBadge } from '../../components/Badges';

/**
 * Customer 360.
 *
 * The whole point of a customer being an entity rather than a copy of a
 * spreadsheet row: one person, every investigation ever run on them, in order.
 * A repeat request against a customer already in the system is exactly where a
 * coordinator wants to see that they were verified positive four months ago —
 * or refused entry twice.
 *
 * Profile and history come in one request, because this page is only ever
 * rendered whole.
 */
export default function CustomerDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => (await api.get(`/customers/${id}`)).data,
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-4 d-block mb-3" style={{ height: 32 }} />
        <span className="placeholder col-12 d-block" style={{ height: 300 }} />
      </div>
    );
  }

  const investigations = data.investigations ?? [];

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/customers" className="small text-decoration-none">
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            {t('customers.title')}
          </Link>
        }
        title={data.fullName}
        subtitle={
          <span className="mono">
            {data.nationalId ?? '—'} · {data.mobile ?? '—'}
          </span>
        }
      />

      <div className="row g-3">
        <div className="col-12 col-lg-4">
          <Panel title={t('customers.customer')} className="mb-3">
            <Field label={t('customers.nationalId')}>
              <span className="mono">{data.nationalId}</span>
            </Field>
            <Field label={t('customers.mobile')}>
              <span className="mono">{data.mobile}</span>
            </Field>
            <Field label={t('customers.altMobile')}>
              <span className="mono">{data.altMobile}</span>
            </Field>
            <Field label={t('customers.homePhone')}>
              <span className="mono">{data.homePhone}</span>
            </Field>
            <Field label={t('customers.email')}>{data.email}</Field>
          </Panel>

          <Panel title={t('cases.tabs.residence')} className="mb-3">
            <Field label={t('customers.residenceAddress')}>{data.residenceAddress}</Field>
            <Field label={t('cases.governorate')}>
              {localisedName(data.governorate, i18n.language)}
            </Field>
            <Field label={t('cases.city')}>
              {localisedName(data.city, i18n.language)}
            </Field>
            <Field label={t('cases.district')}>
              {localisedName(data.district, i18n.language)}
            </Field>
          </Panel>

          <Panel title={t('cases.tabs.workplace')}>
            <Field label={t('customers.workplaceName')}>{data.workplaceName}</Field>
            <Field label={t('customers.jobTitle')}>{data.jobTitle}</Field>
            <Field label={t('customers.workplaceAddress')}>
              {data.workplaceAddress}
            </Field>
            <Field label={t('customers.workplacePhone')}>
              <span className="mono">{data.workplacePhone}</span>
            </Field>
          </Panel>
        </div>

        <div className="col-12 col-lg-8">
          <Panel
            title={`${t('customers.history')} (${investigations.length})`}
            bodyClassName="p-0"
          >
            {investigations.length === 0 ? (
              <EmptyState title={t('customers.noHistory')} icon="folder2-open" />
            ) : (
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>{t('cases.caseNumber')}</th>
                      <th>{t('cases.investigationType')}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('cases.result')}</th>
                      <th>{t('cases.investigator')}</th>
                      <th>{t('common.createdAt')}</th>
                      <th>{t('reports.title')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {investigations.map((investigation) => (
                      <tr key={investigation.id}>
                        <td>
                          <Link
                            to={`/investigations/${investigation.id}`}
                            className="mono text-decoration-none fw-semibold"
                          >
                            {investigation.caseNumber}
                          </Link>
                          <div>
                            <PriorityBadge priority={investigation.priority} />
                          </div>
                        </td>
                        <td className="small">
                          {localisedName(investigation.investigationType, i18n.language)}
                          <div className="text-body-secondary">
                            {localisedName(investigation.product, i18n.language)}
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={investigation.status} />
                        </td>
                        <td className="small">
                          {investigation.result
                            ? t(`result.${investigation.result}`)
                            : '—'}
                        </td>
                        <td className="small">
                          {investigation.investigator?.fullName ?? '—'}
                        </td>
                        <td className="small text-nowrap">
                          {new Date(investigation.createdAt).toLocaleDateString(
                            i18n.language,
                          )}
                        </td>
                        <td>
                          {investigation.reports?.length > 0 ? (
                            <Link
                              to={`/investigations/${investigation.id}?tab=report`}
                              className="badge text-bg-success text-decoration-none"
                            >
                              <i className="bi bi-file-earmark-pdf me-1" aria-hidden="true" />
                              v{investigation.reports[0].version}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

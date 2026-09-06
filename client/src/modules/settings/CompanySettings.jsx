import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import PageHeader, { Field, Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import { useToast } from '../../components/Toast';

/**
 * Company profile, plan usage and feature flags.
 *
 * WHAT IS NOT EDITABLE HERE IS AS DELIBERATE AS WHAT IS. Plan limits, the
 * subscription window and the company status are absent — a tenant raising its
 * own user cap is not a request this API can express, and the DTO refuses the
 * field outright rather than ignoring it. Those live with the platform
 * operator.
 *
 * A feature flag SUBTRACTS. Switching one off removes its permissions from
 * every user whatever their role says; switching it back on grants nobody
 * anything they were not already given. The hint says so, because an
 * administrator who expects the second behaviour will be confused when nothing
 * happens.
 */
export default function CompanySettings() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [profile, setProfile] = useState(null);
  const [flags, setFlags] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tenant-me'],
    queryFn: async () => (await api.get('/tenants/me')).data,
  });

  useEffect(() => {
    if (!data) return;
    setProfile({
      nameAr: data.nameAr ?? '',
      nameEn: data.nameEn ?? '',
      logoUrl: data.logoUrl ?? '',
      primaryColor: data.primaryColor ?? '#1d4ed8',
      taxId: data.taxId ?? '',
      phone: data.phone ?? '',
      email: data.email ?? '',
      addressLine: data.addressLine ?? '',
    });
    setFlags(data.featureFlags ?? {});
  }, [data]);

  const saveProfile = useMutation({
    mutationFn: async () => (await api.patch('/tenants/me', profile)).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      queryClient.invalidateQueries({ queryKey: ['tenant-me'] });
    },
    onError: (mutationError) =>
      toast.error(localiseServerMessage(mutationError.friendlyMessage)),
  });

  const saveSettings = useMutation({
    mutationFn: async (patch) =>
      (await api.patch('/tenants/me/settings', patch)).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      queryClient.invalidateQueries({ queryKey: ['tenant-me'] });
      // Flags change what every user may do, so the principal has to be
      // re-resolved — a reload is the bluntest correct way to do that.
      setTimeout(() => window.location.reload(), 600);
    },
    onError: (mutationError) =>
      toast.error(localiseServerMessage(mutationError.friendlyMessage)),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading || !profile) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-12 d-block" style={{ height: 280 }} />
      </div>
    );
  }

  const set = (key) => (event) =>
    setProfile((current) => ({ ...current, [key]: event.target.value }));

  const featureKeys = [
    'investigations',
    'customers',
    'investigators',
    'imports',
    'qc',
    'forms',
    'reports',
    'media',
    'sla',
    'audit',
    'clients',
  ];

  return (
    <>
      <PageHeader title={t('settings.title')} />

      <div className="row g-3">
        <div className="col-12 col-lg-7">
          <Panel
            title={t('settings.company')}
            actions={
              can(P.TENANT_MANAGE) && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary py-0"
                  onClick={() => saveProfile.mutate()}
                  disabled={saveProfile.isPending}
                >
                  {saveProfile.isPending ? t('common.saving') : t('common.save')}
                </button>
              )
            }
          >
            <div className="row g-2">
              <div className="col-12 col-md-6">
                <label className="form-label small fw-semibold">
                  {t('common.nameAr')}
                </label>
                <input
                  className="form-control form-control-sm"
                  value={profile.nameAr}
                  onChange={set('nameAr')}
                  disabled={!can(P.TENANT_MANAGE)}
                />
              </div>
              <div className="col-12 col-md-6">
                <label className="form-label small fw-semibold">
                  {t('common.nameEn')}
                </label>
                <input
                  className="form-control form-control-sm"
                  dir="ltr"
                  value={profile.nameEn}
                  onChange={set('nameEn')}
                  disabled={!can(P.TENANT_MANAGE)}
                />
              </div>
              <div className="col-12 col-md-6">
                <label className="form-label small fw-semibold">
                  {t('settings.logo')}
                </label>
                <input
                  className="form-control form-control-sm"
                  dir="ltr"
                  placeholder="https://…"
                  value={profile.logoUrl}
                  onChange={set('logoUrl')}
                  disabled={!can(P.TENANT_MANAGE)}
                />
              </div>
              <div className="col-6 col-md-3">
                <label className="form-label small fw-semibold">
                  {t('settings.primaryColor')}
                </label>
                <input
                  type="color"
                  className="form-control form-control-color form-control-sm w-100"
                  value={profile.primaryColor}
                  onChange={set('primaryColor')}
                  disabled={!can(P.TENANT_MANAGE)}
                />
              </div>
              <div className="col-6 col-md-3">
                <label className="form-label small fw-semibold">
                  {t('settings.taxId')}
                </label>
                <input
                  className="form-control form-control-sm mono"
                  dir="ltr"
                  value={profile.taxId}
                  onChange={set('taxId')}
                  disabled={!can(P.TENANT_MANAGE)}
                />
              </div>
              <div className="col-6 col-md-6">
                <label className="form-label small fw-semibold">
                  {t('investigators.phone')}
                </label>
                <input
                  className="form-control form-control-sm mono"
                  dir="ltr"
                  value={profile.phone}
                  onChange={set('phone')}
                  disabled={!can(P.TENANT_MANAGE)}
                />
              </div>
              <div className="col-6 col-md-6">
                <label className="form-label small fw-semibold">
                  {t('customers.email')}
                </label>
                <input
                  className="form-control form-control-sm"
                  dir="ltr"
                  value={profile.email}
                  onChange={set('email')}
                  disabled={!can(P.TENANT_MANAGE)}
                />
              </div>
              <div className="col-12">
                <label className="form-label small fw-semibold">
                  {t('settings.address')}
                </label>
                <input
                  className="form-control form-control-sm"
                  value={profile.addressLine}
                  onChange={set('addressLine')}
                  disabled={!can(P.TENANT_MANAGE)}
                />
              </div>
            </div>
          </Panel>

          {can(P.SETTINGS_MANAGE) && (
            <Panel
              title={t('settings.features')}
              className="mt-3"
              actions={
                <button
                  type="button"
                  className="btn btn-sm btn-primary py-0"
                  onClick={() => saveSettings.mutate({ featureFlags: flags })}
                  disabled={saveSettings.isPending}
                >
                  {t('common.save')}
                </button>
              }
            >
              <p className="small text-body-secondary">{t('settings.featuresHint')}</p>

              <div className="row g-2">
                {featureKeys.map((feature) => (
                  <div className="col-12 col-md-6" key={feature}>
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        role="switch"
                        id={`feature-${feature}`}
                        checked={flags?.[feature] !== false}
                        onChange={(event) =>
                          setFlags((current) => ({
                            ...current,
                            [feature]: event.target.checked,
                          }))
                        }
                      />
                      <label
                        className="form-check-label small"
                        htmlFor={`feature-${feature}`}
                      >
                        {t(`nav.${feature}`, feature)}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        <div className="col-12 col-lg-5">
          <Panel title={t('settings.plan')}>
            <Field label={t('common.code')}>
              <span className="mono">{data.code}</span>
            </Field>
            <Field label={t('common.status')}>
              <span
                className={`badge text-bg-${
                  data.status === 'ACTIVE'
                    ? 'success'
                    : data.status === 'TRIAL'
                      ? 'info'
                      : 'danger'
                }`}
              >
                {data.status}
              </span>
            </Field>
            <Field label={t('settings.subscriptionEnds')}>
              {data.subscriptionEnd
                ? new Date(data.subscriptionEnd).toLocaleDateString(i18n.language)
                : null}
            </Field>

            <hr />

            <UsageBar
              label={t('settings.maxUsers')}
              used={data.usage?.users}
              limit={data.usage?.maxUsers}
            />
            <UsageBar
              label={t('settings.maxInvestigators')}
              used={data.usage?.investigators}
              limit={data.usage?.maxInvestigators}
            />

            <hr />

            <Field label={t('cases.title')}>{data.usage?.investigations ?? 0}</Field>
            <Field label={t('customers.title')}>{data.usage?.customers ?? 0}</Field>
          </Panel>
        </div>
      </div>
    </>
  );
}

function UsageBar({ label, used = 0, limit = 0 }) {
  const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between small">
        <span className="text-body-secondary">{label}</span>
        <span>
          {used} / {limit}
        </span>
      </div>
      <div className="progress" style={{ height: 6 }}>
        <div
          className={`progress-bar ${
            percent >= 90 ? 'bg-danger' : percent >= 70 ? 'bg-warning' : 'bg-success'
          }`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { useInvestigationTypes, useProducts, useRoles } from '../../hooks/useCatalog';
import PageHeader, { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * SLA policies and escalation rules.
 *
 * THERE ARE NO HARD-CODED TIME VALUES IN THE ESCALATION ENGINE — every
 * threshold on this page is a database row, which is what makes "notify after
 * 90 minutes instead of two hours" a settings change rather than a deploy.
 *
 * Policy resolution is most-specific-first: a policy naming both a product and
 * a type beats one naming only the product, which beats the tenant default.
 * The scope selectors say "any" rather than being left blank, so that ordering
 * is visible instead of implied.
 */
export default function SlaSettings() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [editingPolicy, setEditingPolicy] = useState(null);
  const [creatingPolicy, setCreatingPolicy] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const { data: policies, isLoading, error, refetch } = useQuery({
    queryKey: ['sla-policies'],
    queryFn: async () => (await api.get('/sla/policies')).data,
  });

  const { data: rules } = useQuery({
    queryKey: ['escalation-rules'],
    queryFn: async () => (await api.get('/sla/escalation-rules')).data,
  });

  const { data: triggers } = useQuery({
    queryKey: ['escalation-triggers'],
    queryFn: async () => (await api.get('/sla/triggers')).data,
  });

  const remove = useMutation({
    mutationFn: async ({ kind, item }) =>
      kind === 'policy'
        ? (await api.delete(`/sla/policies/${item.id}`)).data
        : (await api.delete(`/sla/escalation-rules/${item.id}`)).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['sla-policies'] });
      queryClient.invalidateQueries({ queryKey: ['escalation-rules'] });
    },
    onError: (mutationError) => {
      toast.error(localiseServerMessage(mutationError.friendlyMessage));
      setDeleting(null);
    },
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader title={t('sla.title')} />

      <div className="row g-3">
        <div className="col-12 col-xl-6">
          <Panel
            title={t('sla.policies')}
            actions={
              can(P.SLA_MANAGE) && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary py-0"
                  onClick={() => setCreatingPolicy(true)}
                >
                  {t('common.add')}
                </button>
              )
            }
            bodyClassName="p-0"
          >
            {isLoading ? (
              <div className="p-3 placeholder-glow">
                <span className="placeholder col-12 d-block" style={{ height: 120 }} />
              </div>
            ) : (
              <ul className="list-group list-group-flush">
                {(policies ?? []).map((policy) => (
                  <li key={policy.id} className="list-group-item">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div className="min-vw-0">
                        <span className="fw-medium">
                          {localisedName(policy, i18n.language)}
                        </span>
                        {policy.isDefault && (
                          <span className="badge text-bg-primary ms-2">
                            {t('sla.isDefault')}
                          </span>
                        )}
                        {!policy.isActive && (
                          <span className="badge text-bg-secondary ms-2">
                            {t('common.inactive')}
                          </span>
                        )}
                        <div className="small text-body-secondary">
                          <span className="mono">{policy.code}</span> ·{' '}
                          {policy.totalHours}h
                          {policy.businessHoursOnly && (
                            <span className="badge text-bg-light ms-2">
                              {t('sla.businessHoursOnly')}
                            </span>
                          )}
                        </div>
                        <div className="small text-body-tertiary">
                          {t('sla.assignmentHours')} {policy.assignmentHours}h ·{' '}
                          {t('sla.fieldHours')} {policy.fieldHours}h ·{' '}
                          {t('sla.qcHours')} {policy.qcHours}h
                        </div>
                      </div>

                      {can(P.SLA_MANAGE) && (
                        <div className="btn-group btn-group-sm flex-shrink-0">
                          <button
                            type="button"
                            className="btn btn-outline-secondary py-0"
                            onClick={() => setEditingPolicy(policy)}
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-danger py-0"
                            onClick={() => setDeleting({ kind: 'policy', item: policy })}
                          >
                            <i className="bi bi-trash" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="col-12 col-xl-6">
          <Panel
            title={t('sla.escalationRules')}
            actions={
              can(P.SLA_MANAGE) && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary py-0"
                  onClick={() => setCreatingRule(true)}
                >
                  {t('common.add')}
                </button>
              )
            }
            bodyClassName="p-0"
          >
            <ul className="list-group list-group-flush">
              {(rules ?? []).map((rule) => (
                <li key={rule.id} className="list-group-item">
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div className="min-vw-0">
                      <span className="fw-medium">
                        {localisedName(rule, i18n.language)}
                      </span>
                      {!rule.isActive && (
                        <span className="badge text-bg-secondary ms-2">
                          {t('common.inactive')}
                        </span>
                      )}
                      <div className="small text-body-secondary">
                        <span className="badge text-bg-light">
                          {t(`escalationTrigger.${rule.trigger}`, rule.trigger)}
                        </span>
                        <span className="ms-2">
                          {t('sla.thresholdMinutes')}: {rule.thresholdMinutes}
                        </span>
                        {rule.repeatEveryMinutes && (
                          <span className="ms-2">
                            {t('sla.repeatEvery')}: {rule.repeatEveryMinutes}
                          </span>
                        )}
                      </div>
                      <div className="small text-body-tertiary">
                        {rule.notifyCoordinator && `${t('sla.notifyCoordinator')} · `}
                        {rule.notifyInvestigator && `${t('sla.notifyInvestigator')} · `}
                        {rule.notifyRoleCodes?.join(', ')}
                      </div>
                    </div>

                    {can(P.SLA_MANAGE) && (
                      <div className="btn-group btn-group-sm flex-shrink-0">
                        <button
                          type="button"
                          className="btn btn-outline-secondary py-0"
                          onClick={() => setEditingRule(rule)}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger py-0"
                          onClick={() => setDeleting({ kind: 'rule', item: rule })}
                        >
                          <i className="bi bi-trash" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {(creatingPolicy || editingPolicy) && (
        <PolicyDialog
          policy={editingPolicy}
          onClose={() => {
            setCreatingPolicy(false);
            setEditingPolicy(null);
          }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['sla-policies'] })}
        />
      )}

      {(creatingRule || editingRule) && (
        <RuleDialog
          rule={editingRule}
          triggers={triggers ?? []}
          onClose={() => {
            setCreatingRule(false);
            setEditingRule(null);
          }}
          onSaved={() =>
            queryClient.invalidateQueries({ queryKey: ['escalation-rules'] })
          }
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting)}
        title={t('common.delete')}
        message={deleting ? localisedName(deleting.item, i18n.language) : ''}
        busy={remove.isPending}
      />
    </>
  );
}

function PolicyDialog({ policy, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { data: products } = useProducts();
  const { data: types } = useInvestigationTypes();

  const [form, setForm] = useState(() => ({
    code: policy?.code ?? '',
    nameAr: policy?.nameAr ?? '',
    nameEn: policy?.nameEn ?? '',
    productId: policy?.productId ?? '',
    investigationTypeId: policy?.investigationTypeId ?? '',
    priority: policy?.priority ?? '',
    totalHours: policy?.totalHours ?? 48,
    assignmentHours: policy?.assignmentHours ?? 4,
    acceptanceHours: policy?.acceptanceHours ?? 2,
    fieldHours: policy?.fieldHours ?? 24,
    qcHours: policy?.qcHours ?? 12,
    warnAtPercent: policy?.warnAtPercent ?? 80,
    businessHoursOnly: policy?.businessHoursOnly ?? false,
    workdayStartHour: policy?.workdayStartHour ?? 9,
    workdayEndHour: policy?.workdayEndHour ?? 17,
    workdays: policy?.workdays ?? [7, 1, 2, 3, 4],
    isDefault: policy?.isDefault ?? false,
    isActive: policy?.isActive ?? true,
  }));

  const stageTotal =
    Number(form.assignmentHours) +
    Number(form.acceptanceHours) +
    Number(form.fieldHours) +
    Number(form.qcHours);
  const stagesExceed = stageTotal > Number(form.totalHours);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        totalHours: Number(form.totalHours),
        assignmentHours: Number(form.assignmentHours),
        acceptanceHours: Number(form.acceptanceHours),
        fieldHours: Number(form.fieldHours),
        qcHours: Number(form.qcHours),
        warnAtPercent: Number(form.warnAtPercent),
        workdayStartHour: Number(form.workdayStartHour),
        workdayEndHour: Number(form.workdayEndHour),
        productId: form.productId || undefined,
        investigationTypeId: form.investigationTypeId || undefined,
        priority: form.priority || undefined,
      };
      if (policy) delete payload.code;

      return policy
        ? (await api.patch(`/sla/policies/${policy.id}`, payload)).data
        : (await api.post('/sla/policies', payload)).data;
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      onSaved?.();
      onClose();
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Modal
      open
      onClose={onClose}
      size="modal-lg"
      title={policy ? t('common.edit') : t('common.add')}
      busy={save.isPending}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => save.mutate()}
            disabled={!form.code || !form.nameAr || stagesExceed || save.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="row g-2 mb-3">
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('common.code')}</label>
          <input
            className="form-control form-control-sm mono text-uppercase"
            dir="ltr"
            value={form.code}
            disabled={Boolean(policy)}
            onChange={(event) =>
              setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
            }
          />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('common.nameAr')}</label>
          <input className="form-control form-control-sm" value={form.nameAr} onChange={set('nameAr')} />
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small fw-semibold">{t('common.nameEn')}</label>
          <input className="form-control form-control-sm" dir="ltr" value={form.nameEn} onChange={set('nameEn')} />
        </div>
      </div>

      <h3 className="h6 small text-uppercase text-body-secondary">{t('sla.scope')}</h3>
      <div className="row g-2 mb-3">
        <div className="col-12 col-md-4">
          <select className="form-select form-select-sm" value={form.productId} onChange={set('productId')}>
            <option value="">{t('sla.anyProduct')}</option>
            {(products ?? []).map((product) => (
              <option key={product.id} value={product.id}>
                {localisedName(product, i18n.language)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12 col-md-4">
          <select
            className="form-select form-select-sm"
            value={form.investigationTypeId}
            onChange={set('investigationTypeId')}
          >
            <option value="">{t('sla.anyType')}</option>
            {(types ?? []).map((type) => (
              <option key={type.id} value={type.id}>
                {localisedName(type, i18n.language)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12 col-md-4">
          <select className="form-select form-select-sm" value={form.priority} onChange={set('priority')}>
            <option value="">{t('sla.anyPriority')}</option>
            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((priority) => (
              <option key={priority} value={priority}>
                {t(`priority.${priority}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row g-2 mb-2">
        {[
          ['totalHours', t('sla.totalHours')],
          ['assignmentHours', t('sla.assignmentHours')],
          ['acceptanceHours', t('sla.acceptanceHours')],
          ['fieldHours', t('sla.fieldHours')],
          ['qcHours', t('sla.qcHours')],
          ['warnAtPercent', t('sla.warnAtPercent')],
        ].map(([key, label]) => (
          <div className="col-6 col-md-4 col-lg-2" key={key}>
            <label className="form-label small fw-semibold">{label}</label>
            <input
              type="number"
              className="form-control form-control-sm"
              value={form[key]}
              onChange={set(key)}
            />
          </div>
        ))}
      </div>

      {stagesExceed && (
        <div className="alert alert-danger py-2 px-3 small">
          {t('sla.stageBudgetsExceed')} ({stageTotal}h &gt; {form.totalHours}h)
        </div>
      )}

      <div className="form-check mb-2">
        <input
          className="form-check-input"
          type="checkbox"
          id="business-hours"
          checked={form.businessHoursOnly}
          onChange={(event) =>
            setForm((current) => ({ ...current, businessHoursOnly: event.target.checked }))
          }
        />
        <label className="form-check-label small" htmlFor="business-hours">
          {t('sla.businessHoursOnly')}
        </label>
      </div>

      {form.businessHoursOnly && (
        <div className="row g-2 mb-2">
          <div className="col-6 col-md-3">
            <label className="form-label small">{t('sla.workdayStart')}</label>
            <input
              type="number"
              min={0}
              max={23}
              className="form-control form-control-sm"
              value={form.workdayStartHour}
              onChange={set('workdayStartHour')}
            />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label small">{t('sla.workdayEnd')}</label>
            <input
              type="number"
              min={1}
              max={24}
              className="form-control form-control-sm"
              value={form.workdayEndHour}
              onChange={set('workdayEndHour')}
            />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label small">{t('sla.workdays')}</label>
            <div className="d-flex flex-wrap gap-1">
              {WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={`btn btn-sm ${
                    form.workdays.includes(day) ? 'btn-primary' : 'btn-outline-secondary'
                  }`}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      workdays: current.workdays.includes(day)
                        ? current.workdays.filter((value) => value !== day)
                        : [...current.workdays, day],
                    }))
                  }
                >
                  {new Date(2024, 0, day).toLocaleDateString(i18n.language, {
                    weekday: 'short',
                  })}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="d-flex gap-3">
        <div className="form-check">
          <input
            className="form-check-input"
            type="checkbox"
            id="policy-default"
            checked={form.isDefault}
            onChange={(event) =>
              setForm((current) => ({ ...current, isDefault: event.target.checked }))
            }
          />
          <label className="form-check-label small" htmlFor="policy-default">
            {t('sla.isDefault')}
          </label>
        </div>
        <div className="form-check">
          <input
            className="form-check-input"
            type="checkbox"
            id="policy-active"
            checked={form.isActive}
            onChange={(event) =>
              setForm((current) => ({ ...current, isActive: event.target.checked }))
            }
          />
          <label className="form-check-label small" htmlFor="policy-active">
            {t('common.active')}
          </label>
        </div>
      </div>
    </Modal>
  );
}

function RuleDialog({ rule, triggers, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { data: roles } = useRoles();

  const [form, setForm] = useState(() => ({
    code: rule?.code ?? '',
    nameAr: rule?.nameAr ?? '',
    nameEn: rule?.nameEn ?? '',
    trigger: rule?.trigger ?? triggers[0] ?? 'NOT_ACCEPTED',
    thresholdMinutes: rule?.thresholdMinutes ?? 120,
    repeatEveryMinutes: rule?.repeatEveryMinutes ?? '',
    notifyRoleCodes: rule?.notifyRoleCodes ?? [],
    notifyCoordinator: rule?.notifyCoordinator ?? true,
    notifyInvestigator: rule?.notifyInvestigator ?? false,
    isActive: rule?.isActive ?? true,
  }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        thresholdMinutes: Number(form.thresholdMinutes),
        repeatEveryMinutes: form.repeatEveryMinutes
          ? Number(form.repeatEveryMinutes)
          : undefined,
      };
      if (rule) delete payload.code;

      return rule
        ? (await api.patch(`/sla/escalation-rules/${rule.id}`, payload)).data
        : (await api.post('/sla/escalation-rules', payload)).data;
    },
    onSuccess: () => {
      toast.success(t('common.saved'));
      onSaved?.();
      onClose();
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? t('common.edit') : t('common.add')}
      busy={save.isPending}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => save.mutate()}
            disabled={!form.code || !form.nameAr || save.isPending}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="row g-2 mb-3">
        <div className="col-12">
          <label className="form-label small fw-semibold">{t('common.code')}</label>
          <input
            className="form-control form-control-sm mono text-uppercase"
            dir="ltr"
            value={form.code}
            disabled={Boolean(rule)}
            onChange={(event) =>
              setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
            }
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">{t('common.nameAr')}</label>
          <input className="form-control form-control-sm" value={form.nameAr} onChange={set('nameAr')} />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">{t('common.nameEn')}</label>
          <input className="form-control form-control-sm" dir="ltr" value={form.nameEn} onChange={set('nameEn')} />
        </div>
        <div className="col-12">
          <label className="form-label small fw-semibold">{t('sla.trigger')}</label>
          <select className="form-select form-select-sm" value={form.trigger} onChange={set('trigger')}>
            {triggers.map((trigger) => (
              <option key={trigger} value={trigger}>
                {t(`escalationTrigger.${trigger}`, trigger)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-6">
          <label className="form-label small fw-semibold">
            {t('sla.thresholdMinutes')}
          </label>
          <input
            type="number"
            className="form-control form-control-sm"
            value={form.thresholdMinutes}
            onChange={set('thresholdMinutes')}
          />
        </div>
        <div className="col-6">
          <label className="form-label small fw-semibold">{t('sla.repeatEvery')}</label>
          <input
            type="number"
            className="form-control form-control-sm"
            placeholder={t('sla.repeatNever')}
            value={form.repeatEveryMinutes}
            onChange={set('repeatEveryMinutes')}
          />
        </div>
      </div>

      <label className="form-label small fw-semibold">{t('sla.notifyRoles')}</label>
      <div className="border rounded p-2 d-flex flex-wrap gap-1 mb-3">
        {(roles ?? []).map((role) => (
          <button
            key={role.id}
            type="button"
            className={`btn btn-sm ${
              form.notifyRoleCodes.includes(role.code)
                ? 'btn-primary'
                : 'btn-outline-secondary'
            }`}
            onClick={() =>
              setForm((current) => ({
                ...current,
                notifyRoleCodes: current.notifyRoleCodes.includes(role.code)
                  ? current.notifyRoleCodes.filter((code) => code !== role.code)
                  : [...current.notifyRoleCodes, role.code],
              }))
            }
          >
            {localisedName(role, i18n.language)}
          </button>
        ))}
      </div>

      <div className="d-flex flex-column gap-1">
        {[
          ['notifyCoordinator', t('sla.notifyCoordinator')],
          ['notifyInvestigator', t('sla.notifyInvestigator')],
          ['isActive', t('common.active')],
        ].map(([key, label]) => (
          <div className="form-check" key={key}>
            <input
              className="form-check-input"
              type="checkbox"
              id={`rule-${key}`}
              checked={form[key]}
              onChange={(event) =>
                setForm((current) => ({ ...current, [key]: event.target.checked }))
              }
            />
            <label className="form-check-label small" htmlFor={`rule-${key}`}>
              {label}
            </label>
          </div>
        ))}
      </div>
    </Modal>
  );
}

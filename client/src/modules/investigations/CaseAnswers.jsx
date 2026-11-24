import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedLabel, localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { conditionsMet } from '../../utils/formConditions';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { Panel } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import Modal from '../../components/Modal';
import InquirySheet from '../forms/InquirySheet';
import { sheetHeader } from '../forms/sheetHeader';
import { useCaseClient } from '../../hooks/useClients';

/**
 * When the office may type in a paper form. Mirrors `OFFICE_ENTRY_STATUSES`
 * in `submissions.service.ts`, which is the control; this only decides
 * whether to offer the button.
 */
const OFFICE_ENTRY_STATUSES = [
  'ASSIGNED',
  'ACCEPTED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'REWORK',
];

/**
 * When the office may switch the case to another form. Mirrors
 * `FORM_CHOICE_STATUSES` in `submissions.service.ts`; the server also refuses
 * once any attempt has been submitted.
 */
const FORM_CHOICE_STATUSES = ['NEW', 'VALIDATING', 'READY_FOR_ASSIGNMENT', ...OFFICE_ENTRY_STATUSES];

/**
 * Open a printable sheet in its own tab. With `formId` it is that form,
 * blank, under this case's header — any form, not only the case's own.
 */
function openPrint(investigationId, { blank = false, formId } = {}) {
  const params = new URLSearchParams();
  if (blank) params.set('blank', '1');
  if (formId) params.set('form', formId);
  const query = params.toString();
  window.open(
    `/print/investigation/${investigationId}${query ? `?${query}` : ''}`,
    '_blank',
    'noopener',
  );
}

/**
 * The investigator's answers, rendered against the form version this case was
 * actually assigned.
 *
 * That pinning is the whole point: reading the answers against the *current*
 * published template would relabel a two-year-old submission with questions
 * that were never asked. The server returns `schema` from
 * `Investigation.formVersionId`, and this renders exactly that.
 *
 * Conditional fields the investigator never saw are skipped rather than shown
 * as empty, or a form with a large "customer not found" branch reads as half
 * unanswered on every case where the customer *was* found.
 *
 * The office can also type in the paper form an investigator brought back
 * (the "enter form" button, drawn as the paper sheet) and print the sheet —
 * blank for the investigator to fill by hand, or filled for the file.
 */
export default function CaseAnswers({ investigationId, investigation }) {
  const { t, i18n } = useTranslation();
  const caseClient = useCaseClient(investigation);
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [dirty, setDirty] = useState(false);
  const [warnings, setWarnings] = useState([]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['case-form', investigationId],
    queryFn: async () =>
      (await api.get(`/forms/investigation/${investigationId}`)).data,
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (answers) =>
      (await api.patch(`/forms/investigation/${investigationId}/office`, { answers }))
        .data,
    onSuccess: (result) => {
      toast.success(t('common.saved'));
      setDirty(false);
      setWarnings(result.warnings ?? []);
      queryClient.invalidateQueries({ queryKey: ['case-form', investigationId] });
    },
    onError: (mutationError) =>
      toast.error(localiseServerMessage(mutationError.friendlyMessage)),
  });

  // ── Hand the paper form in: the case goes to QC ─────────────────────────
  const [handingIn, setHandingIn] = useState(false);
  const [outcome, setOutcome] = useState('');

  const handIn = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/forms/investigation/${investigationId}/office/submit`, {
          // While editing, send what is on screen (saved or not); otherwise the
          // server hands in the draft it already holds.
          ...(editing ? { answers: draft } : {}),
          ...(outcome ? { result: outcome } : {}),
        })
      ).data,
    onSuccess: () => {
      toast.success(t('inquirySheet.handedIn'));
      setHandingIn(false);
      setOutcome('');
      setEditing(false);
      setDirty(false);
      setWarnings([]);
      for (const key of [
        ['case-form', investigationId],
        ['investigation', investigationId],
        ['investigation-timeline', investigationId],
        ['investigation-counts'],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (mutationError) => {
      setHandingIn(false);
      // An incomplete form comes back with the list of what is missing.
      const problems = mutationError.details?.problems;
      if (Array.isArray(problems) && problems.length) {
        // Open the sheet on what was handed in, so the gaps can be filled.
        if (!editing) {
          setDraft({ ...(data?.submission?.answers ?? {}) });
          setDirty(false);
          setEditing(true);
        }
        setWarnings(problems);
      }
      toast.error(localiseServerMessage(mutationError.friendlyMessage));
    },
  });

  // Every published form the tenant has — one blank-print button each, and
  // the choices for which form this case is answered on.
  const { data: templates } = useQuery({
    queryKey: ['forms', 'active'],
    queryFn: async () => (await api.get('/forms', { params: { activeOnly: true } })).data,
    enabled: can(P.FORMS_VIEW),
  });
  const forms = (templates ?? []).filter((template) =>
    template.versions?.some((version) => version.isPublished),
  );

  const choose = useMutation({
    mutationFn: async ({ formTemplateId, discardDraft }) =>
      (
        await api.put(`/forms/investigation/${investigationId}/form`, {
          formTemplateId,
          discardDraft,
        })
      ).data,
    onSuccess: (result) => {
      // Say what changed: a bare "saved" after clicking what looks like a
      // view switch reads as the screen saving something on its own.
      toast.success(
        t('inquirySheet.formChanged', { name: localisedName(result, i18n.language) }),
      );
      setEditing(false);
      setDirty(false);
      setWarnings([]);
      queryClient.invalidateQueries({ queryKey: ['case-form', investigationId] });
    },
    onError: (mutationError) =>
      toast.error(localiseServerMessage(mutationError.friendlyMessage)),
  });

  const currentFormId = data?.templateId;
  const submission = data?.submission;
  const hasTypedAnswers =
    submission?.status === 'DRAFT' && Object.keys(submission.answers ?? {}).length > 0;
  const canChoose =
    can(P.INVESTIGATIONS_EDIT) &&
    FORM_CHOICE_STATUSES.includes(investigation?.status) &&
    (!submission || submission.status === 'DRAFT');

  // Switching is a stored change to the case, not a way of viewing the other
  // form (that is what the blank-print buttons are for), so it always asks.
  const pickForm = (form) => {
    if (form.id === currentFormId || choose.isPending) return;
    const name = localisedName(form, i18n.language);
    const question = hasTypedAnswers
      ? `${t('inquirySheet.confirmSwitch', { name })}\n\n${t('inquirySheet.switchDiscards')}`
      : t('inquirySheet.confirmSwitch', { name });
    if (!window.confirm(question)) return;
    choose.mutate({ formTemplateId: form.id, discardDraft: hasTypedAnswers });
  };

  // Which form this case is answered on, and a blank print of every form.
  const formBar = forms.length > 0 && (
    <div className="d-flex flex-wrap gap-3 align-items-center mb-3 pb-3 border-bottom">
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <span className="small fw-semibold">{t('inquirySheet.caseForm')}</span>
        <div className="btn-group btn-group-sm" role="group" aria-label={t('inquirySheet.caseForm')}>
          {forms.map((form) => {
            const active = form.id === currentFormId;
            return (
              <button
                key={form.id}
                type="button"
                className={`btn ${active ? 'btn-primary' : 'btn-outline-primary'}`}
                aria-pressed={active}
                onClick={() => pickForm(form)}
                disabled={!active && (!canChoose || choose.isPending)}
              >
                {localisedName(form, i18n.language)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="d-flex flex-wrap gap-2 align-items-center ms-auto">
        <span className="small fw-semibold">{t('inquirySheet.printBlankOf')}</span>
        {forms.map((form) => (
          <button
            key={form.id}
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => openPrint(investigationId, { blank: true, formId: form.id })}
          >
            <i className="bi bi-printer me-1" aria-hidden="true" />
            {localisedName(form, i18n.language)}
          </button>
        ))}
      </div>
    </div>
  );

  if (error) {
    // A case whose type has no form is a legitimate configuration, not a
    // failure — say so, and still offer to put the case on one.
    if (error.status === 404) {
      return (
        <>
          {formBar}
          <EmptyState title={t('forms.noForms')} icon="ui-checks" />
        </>
      );
    }
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-12 d-block" style={{ height: 220 }} />
      </div>
    );
  }

  const answers = submission?.answers ?? {};
  const canEnter =
    can(P.INVESTIGATIONS_EDIT) && OFFICE_ENTRY_STATUSES.includes(investigation?.status);

  const startEditing = () => {
    setDraft({ ...answers });
    setDirty(false);
    setWarnings([]);
    setEditing(true);
  };

  const stopEditing = () => {
    if (dirty && !window.confirm(t('common.unsavedChanges'))) return;
    setEditing(false);
    setWarnings([]);
  };

  const toolbar = (
    <>
    {formBar}
    <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
      {editing ? (
        <>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => save.mutate(draft)}
            disabled={!dirty || save.isPending}
          >
            <i className="bi bi-floppy me-1" aria-hidden="true" />
            {t('common.save')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={stopEditing}
            disabled={save.isPending}
          >
            {t('common.close')}
          </button>
          {dirty && (
            <span className="small text-warning-emphasis">{t('common.unsavedChanges')}</span>
          )}
          <button
            type="button"
            className="btn btn-sm btn-success"
            onClick={() => setHandingIn(true)}
            disabled={save.isPending || handIn.isPending}
          >
            <i className="bi bi-send-check me-1" aria-hidden="true" />
            {t('inquirySheet.handIn')}
          </button>
        </>
      ) : (
        canEnter && (
          <>
            <button type="button" className="btn btn-sm btn-primary" onClick={startEditing}>
              <i className="bi bi-pencil-square me-1" aria-hidden="true" />
              {submission ? t('inquirySheet.edit') : t('inquirySheet.enter')}
            </button>
            {submission?.status === 'DRAFT' && (
              <button
                type="button"
                className="btn btn-sm btn-success"
                onClick={() => setHandingIn(true)}
                disabled={handIn.isPending}
              >
                <i className="bi bi-send-check me-1" aria-hidden="true" />
                {t('inquirySheet.handIn')}
              </button>
            )}
          </>
        )
      )}

      <span className="ms-auto d-flex flex-wrap gap-2">
        {forms.length === 0 && (
          // Without the forms list (no forms.view), still offer this case's own.
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => openPrint(investigationId, { blank: true })}
          >
            <i className="bi bi-printer me-1" aria-hidden="true" />
            {t('inquirySheet.printBlank')}
          </button>
        )}
        {submission && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => openPrint(investigationId)}
            disabled={dirty}
            title={dirty ? t('common.unsavedChanges') : undefined}
          >
            <i className="bi bi-printer-fill me-1" aria-hidden="true" />
            {t('inquirySheet.printFilled')}
          </button>
        )}
      </span>
    </div>

    <Modal
      open={handingIn}
      onClose={() => setHandingIn(false)}
      title={t('inquirySheet.handIn')}
      busy={handIn.isPending}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => setHandingIn(false)}
            disabled={handIn.isPending}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-success"
            onClick={() => handIn.mutate()}
            disabled={handIn.isPending}
          >
            {handIn.isPending && (
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
            )}
            {t('inquirySheet.handInConfirm')}
          </button>
        </>
      }
    >
      <p className="mb-3">{t('inquirySheet.handInHint')}</p>
      <label className="form-label small fw-semibold" htmlFor="handInOutcome">
        {t('inquirySheet.outcome')}
      </label>
      <select
        id="handInOutcome"
        className="form-select"
        value={outcome}
        onChange={(event) => setOutcome(event.target.value)}
      >
        <option value="">{t('inquirySheet.outcomeNone')}</option>
        {['POSITIVE', 'NEGATIVE', 'PARTIAL', 'NOT_FOUND', 'REFUSED', 'UNREACHABLE'].map(
          (value) => (
            <option key={value} value={value}>
              {t(`result.${value}`)}
            </option>
          ),
        )}
      </select>
    </Modal>
    </>
  );

  if (editing) {
    return (
      <>
        {toolbar}
        <p className="small text-body-secondary">{t('inquirySheet.enterHint')}</p>
        {warnings.length > 0 && (
          <div className="alert alert-warning py-2 px-3 small">
            <span className="fw-semibold">{t('inquirySheet.warnings')}</span>
            <ul className="mb-0 mt-1 ps-3">
              {warnings.map((warning, index) => (
                <li key={index}>
                  {localisedLabel(warning, i18n.language)}:{' '}
                  {i18n.language === 'ar' ? warning.reasonAr : warning.reasonEn}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Panel>
          <InquirySheet
            title={localisedName(data, i18n.language)}
            header={sheetHeader(t, investigation)}
            schema={data.schema}
            brand={caseClient}
            answers={draft}
            onChange={(key, value) => {
              setDraft((current) => ({ ...current, [key]: value }));
              setDirty(true);
            }}
          />
        </Panel>
      </>
    );
  }

  if (!submission) {
    return (
      <>
        {toolbar}
        <EmptyState title={t('common.empty')} icon="ui-checks" />
      </>
    );
  }

  const visibleSections = (data.schema?.sections ?? []).filter((section) =>
    conditionsMet(section.visibleWhen, answers),
  );

  return (
    <>
      {toolbar}
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <span className="badge text-bg-light">
          {t('forms.version', { n: data.version })}
        </span>
        {submission.status === 'DRAFT' && (
          <span className="badge text-bg-warning">{t('inquirySheet.draftBadge')}</span>
        )}
        <span className="badge text-bg-light">
          {t('qc.attempt', { n: submission.attempt })}
        </span>
        {submission.submittedAt && (
          <span className="small text-body-secondary">
            {new Date(submission.submittedAt).toLocaleString(i18n.language)}
          </span>
        )}
      </div>

      {submission.autoValidation && (
        <div
          className={`alert py-2 px-3 small ${
            submission.autoValidation.passed ? 'alert-success' : 'alert-warning'
          }`}
        >
          <span className="fw-semibold">
            <i
              className={`bi bi-${
                submission.autoValidation.passed ? 'check-circle' : 'exclamation-triangle'
              } me-1`}
              aria-hidden="true"
            />
            {submission.autoValidation.passed
              ? t('qc.autoPassed')
              : t('qc.autoFailed')}
          </span>
          {submission.autoValidation.problems?.length > 0 && (
            <ul className="mb-0 mt-1 ps-3">
              {submission.autoValidation.problems.map((problem, index) => (
                <li key={index}>
                  {i18n.language === 'ar' ? problem.reasonAr : problem.reasonEn}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="d-flex flex-column gap-3">
        {visibleSections.map((section) => {
          const fields = (section.fields ?? []).filter(
            (field) =>
              field.type !== 'SECTION_NOTE' &&
              conditionsMet(field.visibleWhen, answers),
          );

          if (fields.length === 0) return null;

          return (
            <Panel key={section.key} title={localisedLabel(section, i18n.language)}>
              <dl className="row mb-0">
                {fields.map((field) => (
                  <div className="col-12 col-md-6 mb-2" key={field.key}>
                    <dt className="small text-body-secondary fw-normal">
                      {localisedLabel(field, i18n.language)}
                    </dt>
                    <dd className="mb-0 fw-medium" style={{ wordBreak: 'break-word' }}>
                      <AnswerValue field={field} value={answers[field.key]} />
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          );
        })}
      </div>
    </>
  );
}

/**
 * Render one answer the way it should read, not the way it is stored.
 *
 * An option's stored value is a stable code (`CUSTOMER_NOT_FOUND`); showing
 * that instead of the label is the classic way a configurable form leaks its
 * internals onto the screen.
 */
function AnswerValue({ field, value }) {
  const { i18n } = useTranslation();

  if (value === null || value === undefined || value === '') {
    return <span className="text-body-tertiary">—</span>;
  }

  if (['PHOTO', 'FILE', 'SIGNATURE'].includes(field.type)) {
    const count = Array.isArray(value) ? value.length : 1;
    return (
      <span className="badge text-bg-light">
        <i className="bi bi-paperclip me-1" aria-hidden="true" />
        {count}
      </span>
    );
  }

  if (field.options?.length) {
    const values = Array.isArray(value) ? value : [value];
    return (
      <span className="d-flex flex-wrap gap-1">
        {values.map((item) => {
          const option = field.options.find((candidate) => candidate.value === String(item));
          return (
            <span key={String(item)} className="badge text-bg-light">
              {option ? localisedLabel(option, i18n.language) : String(item)}
            </span>
          );
        })}
      </span>
    );
  }

  if (field.type === 'GPS' && typeof value === 'object') {
    return (
      <a
        className="mono text-decoration-none"
        href={`https://www.google.com/maps?q=${value.lat},${value.lng}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {value.lat}, {value.lng}
      </a>
    );
  }

  if (field.type === 'RATING') {
    const scale = field.scale ?? 5;
    return (
      <span title={`${value}/${scale}`}>
        {Array.from({ length: scale }).map((_, index) => (
          <i
            key={index}
            className={`bi bi-star${index < Number(value) ? '-fill text-warning' : ''}`}
            aria-hidden="true"
          />
        ))}
      </span>
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join('، ');
  }

  if (typeof value === 'object') {
    return <code className="small">{JSON.stringify(value)}</code>;
  }

  return String(value);
}

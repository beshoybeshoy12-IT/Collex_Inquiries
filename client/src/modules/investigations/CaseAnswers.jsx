import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { localisedLabel } from '../../i18n';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { Panel } from '../../components/PageHeader';

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
 */
export default function CaseAnswers({ investigationId }) {
  const { t, i18n } = useTranslation();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['case-form', investigationId],
    queryFn: async () =>
      (await api.get(`/forms/investigation/${investigationId}`)).data,
    retry: false,
  });

  if (error) {
    // A case whose type has no form is a legitimate configuration, not a
    // failure — say so rather than showing an error.
    if (error.status === 404) {
      return <EmptyState title={t('forms.noForms')} icon="ui-checks" />;
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

  const submission = data?.submission;
  const answers = submission?.answers ?? {};

  if (!submission) {
    return <EmptyState title={t('common.empty')} icon="ui-checks" />;
  }

  const visibleSections = (data.schema?.sections ?? []).filter((section) =>
    conditionsMet(section.visibleWhen, answers),
  );

  return (
    <>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <span className="badge text-bg-light">
          {t('forms.version', { n: data.version })}
        </span>
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

/**
 * The client-side twin of the server's `isVisible`.
 *
 * Both read the same `visibleWhen` data from the same schema, so a field the
 * investigator never saw is skipped identically here and in the answer
 * validator. Keeping them in step matters: if this one is more permissive, the
 * report shows a question that was never asked.
 */
function conditionsMet(conditions, answers) {
  if (!conditions?.length) return true;

  return conditions.every((condition) => {
    const actual = answers[condition.field];
    const isEmpty =
      actual === null ||
      actual === undefined ||
      actual === '' ||
      (Array.isArray(actual) && actual.length === 0);

    switch (condition.operator) {
      case 'EQUALS':
        return String(actual ?? '') === String(condition.value ?? '');
      case 'NOT_EQUALS':
        return String(actual ?? '') !== String(condition.value ?? '');
      case 'IN':
        return (
          Array.isArray(condition.value) &&
          condition.value.map(String).includes(String(actual ?? ''))
        );
      case 'NOT_IN':
        return (
          Array.isArray(condition.value) &&
          !condition.value.map(String).includes(String(actual ?? ''))
        );
      case 'IS_EMPTY':
        return isEmpty;
      case 'IS_NOT_EMPTY':
        return !isEmpty;
      default:
        return true;
    }
  });
}

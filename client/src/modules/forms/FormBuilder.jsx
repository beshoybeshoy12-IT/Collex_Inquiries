import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedLabel, localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import { useMediaCategories } from '../../hooks/useCatalog';
import PageHeader, { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The form builder.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  A PUBLISHED VERSION IS READ-ONLY HERE, and the screen says so rather than
 *  letting somebody type into fields that will be refused on save. Editing a
 *  published version would reinterpret two-year-old answers against questions
 *  that were never asked — the builder clones it into a new draft instead.
 *
 *  THE FIELD KEY IS IMMUTABLE ONCE PUBLISHED. Answers are stored under it, so
 *  renaming it orphans every answer ever given. New drafts may still rename,
 *  because nothing has answered them yet.
 *
 *  CONDITIONAL LOGIC IS BUILT FROM DROPDOWNS, not typed as an expression. The
 *  rules are evaluated on an investigator's handset; an expression language a
 *  tenant administrator can type into is a code-execution surface with no
 *  upside.
 */
export default function FormBuilder() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [versionId, setVersionId] = useState(null);
  const [schema, setSchema] = useState(null);
  const [selectedField, setSelectedField] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const { data: template, isLoading, error, refetch } = useQuery({
    queryKey: ['form-template', id],
    queryFn: async () => (await api.get(`/forms/${id}`)).data,
  });

  const { data: fieldTypes } = useQuery({
    queryKey: ['form-field-types'],
    queryFn: async () => (await api.get('/forms/field-types')).data,
  });

  const { data: mediaCategories } = useMediaCategories();

  // Open the draft if there is one, otherwise the published version.
  useEffect(() => {
    if (!template || versionId) return;
    const draft = template.versions?.find((version) => !version.isPublished);
    const target = draft ?? template.versions?.[0];
    if (target) {
      setVersionId(target.id);
      setSchema(target.schema ?? { sections: [] });
    }
  }, [template, versionId]);

  const version = template?.versions?.find((candidate) => candidate.id === versionId);
  const readOnly = version?.isPublished ?? true;

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/forms/${id}/versions/${versionId}`, { schema })).data,
    onSuccess: () => {
      toast.success(t('common.saved'));
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['form-template', id] });
    },
    onError: (mutationError) => {
      // The schema validator returns every problem it found, not just the
      // first — showing them all is the difference between one fix and six
      // save attempts.
      const problems = mutationError.details?.problems;
      toast.error(
        problems?.length
          ? `${t('forms.schemaProblems')}\n${problems.join('\n')}`
          : localiseServerMessage(mutationError.friendlyMessage),
      );
    },
  });

  const createDraft = useMutation({
    mutationFn: async () => (await api.post(`/forms/${id}/versions`, {})).data,
    onSuccess: (draft) => {
      toast.success(t('forms.newVersion'));
      setVersionId(draft.id);
      setSchema(draft.schema ?? { sections: [] });
      queryClient.invalidateQueries({ queryKey: ['form-template', id] });
    },
    onError: (mutationError) => {
      // A draft already exists — switch to it rather than reporting a failure.
      if (mutationError.errorCode === 'DRAFT_EXISTS' && mutationError.details?.draftId) {
        setVersionId(mutationError.details.draftId);
        toast.info(t('forms.draft'));
        return;
      }
      toast.error(localiseServerMessage(mutationError.friendlyMessage));
    },
  });

  const publish = useMutation({
    mutationFn: async () =>
      (await api.post(`/forms/${id}/versions/${versionId}/publish`)).data,
    onSuccess: () => {
      toast.success(t('forms.published'));
      setPublishing(false);
      queryClient.invalidateQueries({ queryKey: ['form-template', id] });
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
    },
    onError: (mutationError) => {
      setPublishing(false);
      const problems = mutationError.details?.problems;
      toast.error(
        problems?.length
          ? `${t('forms.schemaProblems')}\n${problems.join('\n')}`
          : localiseServerMessage(mutationError.friendlyMessage),
      );
    },
  });

  // Every field key in the form, for the conditional-logic dropdown.
  const allFields = useMemo(() => {
    const out = [];
    for (const section of schema?.sections ?? []) {
      for (const field of section.fields ?? []) {
        out.push(field);
      }
    }
    return out;
  }, [schema]);

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading || !schema) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-4 d-block mb-3" style={{ height: 32 }} />
        <span className="placeholder col-12 d-block" style={{ height: 320 }} />
      </div>
    );
  }

  const mutate = (updater) => {
    setSchema((current) => updater(structuredClone(current)));
    setDirty(true);
  };

  const addSection = () =>
    mutate((next) => {
      next.sections.push({
        key: `section${next.sections.length + 1}`,
        titleAr: 'قسم جديد',
        titleEn: 'New section',
        fields: [],
      });
      return next;
    });

  const addField = (sectionIndex) =>
    mutate((next) => {
      const count = next.sections[sectionIndex].fields.length + 1;
      next.sections[sectionIndex].fields.push({
        key: `field${Date.now().toString().slice(-6)}`,
        type: 'TEXT',
        labelAr: `حقل ${count}`,
        labelEn: `Field ${count}`,
        required: false,
      });
      return next;
    });

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/admin/forms" className="small text-decoration-none">
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            {t('forms.title')}
          </Link>
        }
        title={localisedName(template, i18n.language)}
        subtitle={
          <span className="d-flex align-items-center gap-2">
            <span className="mono">{template.code}</span>
            {version && (
              <span
                className={`badge text-bg-${version.isPublished ? 'success' : 'warning'}`}
              >
                {t('forms.version', { n: version.version })} ·{' '}
                {version.isPublished ? t('forms.published') : t('forms.draft')}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <select
              className="form-select form-select-sm"
              style={{ width: 'auto' }}
              value={versionId ?? ''}
              onChange={(event) => {
                const next = template.versions.find(
                  (candidate) => candidate.id === event.target.value,
                );
                setVersionId(next.id);
                setSchema(next.schema ?? { sections: [] });
                setSelectedField(null);
                setDirty(false);
              }}
            >
              {template.versions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  v{candidate.version} ·{' '}
                  {candidate.isPublished ? t('forms.published') : t('forms.draft')}
                </option>
              ))}
            </select>

            {readOnly && can(P.FORMS_EDIT) && (
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                onClick={() => createDraft.mutate()}
                disabled={createDraft.isPending}
              >
                <i className="bi bi-files me-1" aria-hidden="true" />
                {t('forms.newVersion')}
              </button>
            )}

            {!readOnly && can(P.FORMS_EDIT) && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => save.mutate()}
                disabled={!dirty || save.isPending}
              >
                {save.isPending && (
                  <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
                )}
                {dirty ? t('common.save') : t('common.saved')}
              </button>
            )}

            {!readOnly && can(P.FORMS_PUBLISH) && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setPublishing(true)}
              >
                <i className="bi bi-send me-1" aria-hidden="true" />
                {t('forms.publish')}
              </button>
            )}
          </>
        }
      />

      {readOnly && (
        <div className="alert alert-secondary py-2 px-3 small">
          <i className="bi bi-lock me-1" aria-hidden="true" />
          {t('forms.publishedCannotEdit')}
        </div>
      )}

      <div className="row g-3">
        {/* ── The canvas ─────────────────────────────────────────────────── */}
        <div className="col-12 col-lg-8">
          {schema.sections.map((section, sectionIndex) => (
            <Panel
              key={section.key}
              className="mb-3"
              title={
                readOnly ? (
                  localisedLabel(section, i18n.language)
                ) : (
                  <input
                    className="form-control form-control-sm"
                    value={i18n.language === 'ar' ? section.titleAr : section.titleEn}
                    onChange={(event) =>
                      mutate((next) => {
                        const key = i18n.language === 'ar' ? 'titleAr' : 'titleEn';
                        next.sections[sectionIndex][key] = event.target.value;
                        return next;
                      })
                    }
                  />
                )
              }
              actions={
                !readOnly && (
                  <div className="btn-group btn-group-sm">
                    <button
                      type="button"
                      className="btn btn-outline-secondary py-0"
                      onClick={() => addField(sectionIndex)}
                    >
                      {t('forms.addField')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-danger py-0"
                      onClick={() =>
                        mutate((next) => {
                          next.sections.splice(sectionIndex, 1);
                          return next;
                        })
                      }
                    >
                      <i className="bi bi-trash" aria-hidden="true" />
                    </button>
                  </div>
                )
              }
            >
              <div className="d-flex flex-column gap-2">
                {(section.fields ?? []).map((field, fieldIndex) => (
                  <div
                    key={field.key}
                    className={`builder-field ${
                      selectedField?.sectionIndex === sectionIndex &&
                      selectedField?.fieldIndex === fieldIndex
                        ? 'selected'
                        : ''
                    }`}
                    onClick={() =>
                      !readOnly && setSelectedField({ sectionIndex, fieldIndex })
                    }
                    role={readOnly ? undefined : 'button'}
                    tabIndex={readOnly ? undefined : 0}
                    onKeyDown={(event) => {
                      if (!readOnly && event.key === 'Enter') {
                        setSelectedField({ sectionIndex, fieldIndex });
                      }
                    }}
                  >
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div className="min-vw-0">
                        <span className="fw-medium">
                          {localisedLabel(field, i18n.language)}
                        </span>
                        {field.required && <span className="text-danger ms-1">*</span>}
                        <div className="small text-body-secondary">
                          <span className="badge text-bg-light me-1">
                            {t(`fieldType.${field.type}`, field.type)}
                          </span>
                          <span className="mono">{field.key}</span>
                          {field.visibleWhen?.length > 0 && (
                            <span className="badge text-bg-info-subtle text-info-emphasis ms-1">
                              <i className="bi bi-diagram-2 me-1" aria-hidden="true" />
                              {field.visibleWhen.length}
                            </span>
                          )}
                        </div>
                      </div>

                      {!readOnly && (
                        <div className="btn-group btn-group-sm flex-shrink-0">
                          <button
                            type="button"
                            className="btn btn-outline-secondary py-0"
                            disabled={fieldIndex === 0}
                            onClick={(event) => {
                              event.stopPropagation();
                              mutate((next) => {
                                const fields = next.sections[sectionIndex].fields;
                                [fields[fieldIndex - 1], fields[fieldIndex]] = [
                                  fields[fieldIndex],
                                  fields[fieldIndex - 1],
                                ];
                                return next;
                              });
                            }}
                          >
                            <i className="bi bi-arrow-up" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-secondary py-0"
                            disabled={fieldIndex === section.fields.length - 1}
                            onClick={(event) => {
                              event.stopPropagation();
                              mutate((next) => {
                                const fields = next.sections[sectionIndex].fields;
                                [fields[fieldIndex], fields[fieldIndex + 1]] = [
                                  fields[fieldIndex + 1],
                                  fields[fieldIndex],
                                ];
                                return next;
                              });
                            }}
                          >
                            <i className="bi bi-arrow-down" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-danger py-0"
                            onClick={(event) => {
                              event.stopPropagation();
                              mutate((next) => {
                                next.sections[sectionIndex].fields.splice(fieldIndex, 1);
                                return next;
                              });
                              setSelectedField(null);
                            }}
                          >
                            <i className="bi bi-trash" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {(section.fields ?? []).length === 0 && (
                  <p className="text-body-secondary small mb-0">{t('common.empty')}</p>
                )}
              </div>
            </Panel>
          ))}

          {!readOnly && (
            <button
              type="button"
              className="btn btn-outline-primary w-100"
              onClick={addSection}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              {t('forms.addSection')}
            </button>
          )}
        </div>

        {/* ── Field properties ───────────────────────────────────────────── */}
        <div className="col-12 col-lg-4">
          {selectedField && !readOnly ? (
            <FieldProperties
              field={
                schema.sections[selectedField.sectionIndex].fields[
                  selectedField.fieldIndex
                ]
              }
              fieldTypes={fieldTypes}
              mediaCategories={mediaCategories ?? []}
              allFields={allFields}
              onChange={(patch) =>
                mutate((next) => {
                  Object.assign(
                    next.sections[selectedField.sectionIndex].fields[
                      selectedField.fieldIndex
                    ],
                    patch,
                  );
                  return next;
                })
              }
            />
          ) : (
            <Panel title={t('common.details')}>
              <p className="small text-body-secondary mb-0">
                {readOnly ? t('forms.publishedCannotEdit') : t('common.empty')}
              </p>
            </Panel>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={publishing}
        onClose={() => setPublishing(false)}
        onConfirm={() => publish.mutate()}
        title={t('forms.publish')}
        message={t('forms.publishHint')}
        tone="primary"
        confirmLabel={t('forms.publish')}
        busy={publish.isPending}
      />
    </>
  );
}

function FieldProperties({ field, fieldTypes, mediaCategories, allFields, onChange }) {
  const { t, i18n } = useTranslation();

  const optionTypes = ['DROPDOWN', 'MULTI_SELECT', 'RADIO', 'CHECKBOX'];
  const mediaTypes = ['PHOTO', 'FILE', 'SIGNATURE'];

  return (
    <Panel title={t('forms.fieldLabel')} className="position-sticky" >
      <div className="mb-2">
        <label className="form-label small fw-semibold">{t('forms.fieldKey')}</label>
        <input
          className="form-control form-control-sm mono"
          dir="ltr"
          value={field.key}
          onChange={(event) => onChange({ key: event.target.value })}
        />
        <div className="form-text small">{t('forms.fieldKeyHint')}</div>
      </div>

      <div className="mb-2">
        <label className="form-label small fw-semibold">{t('forms.fieldType')}</label>
        <select
          className="form-select form-select-sm"
          value={field.type}
          onChange={(event) => onChange({ type: event.target.value })}
        >
          {(fieldTypes?.fieldTypes ?? []).map((type) => (
            <option key={type} value={type}>
              {t(`fieldType.${type}`, type)}
            </option>
          ))}
        </select>
      </div>

      <div className="row g-2 mb-2">
        <div className="col-6">
          <label className="form-label small fw-semibold">{t('common.nameAr')}</label>
          <input
            className="form-control form-control-sm"
            value={field.labelAr ?? ''}
            onChange={(event) => onChange({ labelAr: event.target.value })}
          />
        </div>
        <div className="col-6">
          <label className="form-label small fw-semibold">{t('common.nameEn')}</label>
          <input
            className="form-control form-control-sm"
            dir="ltr"
            value={field.labelEn ?? ''}
            onChange={(event) => onChange({ labelEn: event.target.value })}
          />
        </div>
      </div>

      <div className="form-check mb-3">
        <input
          className="form-check-input"
          type="checkbox"
          id="field-required"
          checked={Boolean(field.required)}
          onChange={(event) => onChange({ required: event.target.checked })}
        />
        <label className="form-check-label small" htmlFor="field-required">
          {t('common.required')}
        </label>
      </div>

      {/* ── Options ──────────────────────────────────────────────────────── */}
      {optionTypes.includes(field.type) && (
        <div className="mb-3">
          <label className="form-label small fw-semibold">{t('forms.options')}</label>
          {(field.options ?? []).map((option, index) => (
            <div className="input-group input-group-sm mb-1" key={index}>
              <input
                className="form-control mono"
                dir="ltr"
                placeholder={t('forms.optionValue')}
                value={option.value}
                onChange={(event) => {
                  const options = [...(field.options ?? [])];
                  options[index] = { ...option, value: event.target.value.toUpperCase() };
                  onChange({ options });
                }}
              />
              <input
                className="form-control"
                placeholder={t('common.nameAr')}
                value={option.labelAr}
                onChange={(event) => {
                  const options = [...(field.options ?? [])];
                  options[index] = { ...option, labelAr: event.target.value };
                  onChange({ options });
                }}
              />
              <input
                className="form-control"
                dir="ltr"
                placeholder={t('common.nameEn')}
                value={option.labelEn}
                onChange={(event) => {
                  const options = [...(field.options ?? [])];
                  options[index] = { ...option, labelEn: event.target.value };
                  onChange({ options });
                }}
              />
              <button
                type="button"
                className="btn btn-outline-danger"
                onClick={() =>
                  onChange({
                    options: (field.options ?? []).filter((_, i) => i !== index),
                  })
                }
              >
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary w-100"
            onClick={() =>
              onChange({
                options: [
                  ...(field.options ?? []),
                  { value: 'OPTION', labelAr: 'خيار', labelEn: 'Option' },
                ],
              })
            }
          >
            {t('forms.addOption')}
          </button>
        </div>
      )}

      {/* ── Media ────────────────────────────────────────────────────────── */}
      {mediaTypes.includes(field.type) && (
        <div className="mb-3">
          <label className="form-label small fw-semibold">
            {t('forms.mediaCategory')}
          </label>
          <select
            className="form-select form-select-sm mb-2"
            value={field.mediaCategoryCode ?? ''}
            onChange={(event) => onChange({ mediaCategoryCode: event.target.value })}
          >
            <option value="">—</option>
            {mediaCategories.map((category) => (
              <option key={category.id} value={category.code}>
                {localisedName(category, i18n.language)}
              </option>
            ))}
          </select>

          <div className="row g-2">
            <div className="col-6">
              <label className="form-label small">{t('forms.minCount')}</label>
              <input
                type="number"
                min={0}
                className="form-control form-control-sm"
                value={field.minCount ?? ''}
                onChange={(event) =>
                  onChange({
                    minCount: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </div>
            <div className="col-6">
              <label className="form-label small">{t('forms.maxCount')}</label>
              <input
                type="number"
                min={1}
                className="form-control form-control-sm"
                value={field.maxCount ?? ''}
                onChange={(event) =>
                  onChange({
                    maxCount: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Validation ───────────────────────────────────────────────────── */}
      {['TEXT', 'LONG_TEXT', 'NUMBER', 'ADDRESS', 'RATING'].includes(field.type) && (
        <div className="mb-3">
          <label className="form-label small fw-semibold">{t('forms.validation')}</label>
          <div className="row g-2">
            {['TEXT', 'LONG_TEXT', 'ADDRESS'].includes(field.type) ? (
              <>
                <div className="col-6">
                  <input
                    type="number"
                    className="form-control form-control-sm"
                    placeholder={t('forms.minLength')}
                    value={field.validation?.minLength ?? ''}
                    onChange={(event) =>
                      onChange({
                        validation: {
                          ...field.validation,
                          minLength: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </div>
                <div className="col-6">
                  <input
                    type="number"
                    className="form-control form-control-sm"
                    placeholder={t('forms.maxLength')}
                    value={field.validation?.maxLength ?? ''}
                    onChange={(event) =>
                      onChange({
                        validation: {
                          ...field.validation,
                          maxLength: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </div>
                <div className="col-12">
                  <select
                    className="form-select form-select-sm"
                    value={field.validation?.pattern ?? ''}
                    onChange={(event) =>
                      onChange({
                        validation: {
                          ...field.validation,
                          pattern: event.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">{t('forms.pattern')}: —</option>
                    {(fieldTypes?.patterns ?? []).map((pattern) => (
                      <option key={pattern} value={pattern}>
                        {pattern}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="col-6">
                  <input
                    type="number"
                    className="form-control form-control-sm"
                    placeholder={t('forms.min')}
                    value={field.validation?.min ?? ''}
                    onChange={(event) =>
                      onChange({
                        validation: {
                          ...field.validation,
                          min: event.target.value ? Number(event.target.value) : undefined,
                        },
                      })
                    }
                  />
                </div>
                <div className="col-6">
                  <input
                    type="number"
                    className="form-control form-control-sm"
                    placeholder={t('forms.max')}
                    value={field.validation?.max ?? ''}
                    onChange={(event) =>
                      onChange({
                        validation: {
                          ...field.validation,
                          max: event.target.value ? Number(event.target.value) : undefined,
                        },
                      })
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Conditional logic ────────────────────────────────────────────── */}
      <div>
        <label className="form-label small fw-semibold">
          {t('forms.conditionalLogic')}
        </label>

        {(field.visibleWhen ?? []).map((condition, index) => (
          <div className="input-group input-group-sm mb-1" key={index}>
            <select
              className="form-select"
              value={condition.field}
              onChange={(event) => {
                const conditions = [...(field.visibleWhen ?? [])];
                conditions[index] = { ...condition, field: event.target.value };
                onChange({ visibleWhen: conditions });
              }}
            >
              <option value="">—</option>
              {allFields
                .filter((candidate) => candidate.key !== field.key)
                .map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {localisedLabel(candidate, i18n.language)}
                  </option>
                ))}
            </select>

            <select
              className="form-select"
              value={condition.operator}
              onChange={(event) => {
                const conditions = [...(field.visibleWhen ?? [])];
                conditions[index] = { ...condition, operator: event.target.value };
                onChange({ visibleWhen: conditions });
              }}
            >
              {(fieldTypes?.conditionOperators ?? []).map((operator) => (
                <option key={operator} value={operator}>
                  {t(`conditionOperator.${operator}`, operator)}
                </option>
              ))}
            </select>

            {!['IS_EMPTY', 'IS_NOT_EMPTY'].includes(condition.operator) && (
              <ConditionValueInput
                condition={condition}
                allFields={allFields}
                language={i18n.language}
                onChange={(value) => {
                  const conditions = [...(field.visibleWhen ?? [])];
                  conditions[index] = { ...condition, value };
                  onChange({ visibleWhen: conditions });
                }}
              />
            )}

            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={() =>
                onChange({
                  visibleWhen: (field.visibleWhen ?? []).filter((_, i) => i !== index),
                })
              }
            >
              <i className="bi bi-x" aria-hidden="true" />
            </button>
          </div>
        ))}

        <button
          type="button"
          className="btn btn-sm btn-outline-secondary w-100"
          onClick={() =>
            onChange({
              visibleWhen: [
                ...(field.visibleWhen ?? []),
                { field: '', operator: 'EQUALS', value: '' },
              ],
            })
          }
        >
          {t('forms.addCondition')}
        </button>
      </div>
    </Panel>
  );
}

/**
 * The value side of a condition.
 *
 * When the referenced field has a fixed option list, this becomes a dropdown of
 * those options — typing a code by hand is how a condition silently never
 * matches, and the field it guards is then invisible forever.
 */
function ConditionValueInput({ condition, allFields, language, onChange }) {
  const target = allFields.find((candidate) => candidate.key === condition.field);

  if (target?.options?.length) {
    return (
      <select
        className="form-select"
        value={condition.value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">—</option>
        {target.options.map((option) => (
          <option key={option.value} value={option.value}>
            {localisedLabel(option, language)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className="form-control"
      value={condition.value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

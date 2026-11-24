import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useProducts, useInvestigationTypes } from '../../hooks/useCatalog';
import { Panel } from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';

/** Only what the batch's client has; an empty list means all. */
function within(list, ids) {
  return ids?.length ? (list ?? []).filter((item) => ids.includes(item.id)) : list ?? [];
}

/** POST a fix to the staged batch and hand back the re-checked batch. */
function useFix(batchId, onFixed) {
  const { t } = useTranslation();
  const toast = useToast();
  return useMutation({
    mutationFn: async (body) => (await api.post(`/imports/${batchId}/fix`, body)).data,
    onSuccess: (batch) => {
      onFixed(batch);
      toast.success(
        batch.invalidRows > 0
          ? t('imports.fix.applied', { count: batch.invalidRows })
          : t('imports.fix.allClear'),
      );
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });
}

/**
 * The quick fixes, above the preview: every value the catalogue did not know
 * ("قرض سلع معمرة"), with a picker to say what it means — applied to every row
 * holding it at once — and the batch default for rows with no product or
 * type. Fixes change the staged copy only; nothing is imported until confirm.
 *
 * @param {{ batch: object, client?: object|null, onFixed: (batch: object) => void }} props
 */
export function FixPanel({ batch, client, onFixed }) {
  const { t, i18n } = useTranslation();
  const { data: allProducts } = useProducts();
  const { data: allTypes } = useInvestigationTypes();
  const options = {
    product: within(allProducts, client?.productIds),
    investigationType: within(allTypes, client?.investigationTypeIds),
  };
  const fix = useFix(batch.id, onFixed);

  const unknown = batch.errorSummary?.unknownValues ?? [];
  const missing = batch.errorSummary?.missingDefaults ?? {};
  const [choice, setChoice] = useState({});

  if (unknown.length === 0 && !missing.product && !missing.investigationType) return null;

  const fieldLabel = (field) =>
    field === 'product' ? t('cases.product') : t('cases.investigationType');

  return (
    <Panel
      title={
        <span>
          <i className="bi bi-wrench-adjustable me-1" aria-hidden="true" />
          {t('imports.fix.title')}
        </span>
      }
      className="mb-3 fix-panel"
    >
      <p className="small text-body-secondary">{t('imports.fix.hint')}</p>

      {unknown.length > 0 && (
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-3">
            <thead>
              <tr>
                <th>{t('imports.fix.valueInFile')}</th>
                <th>{t('imports.fix.field')}</th>
                <th className="text-center">{t('imports.fix.rows')}</th>
                <th style={{ minWidth: 220 }}>{t('imports.fix.means')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {unknown.map((entry) => {
                const key = `${entry.field}::${entry.value}`;
                const picked = choice[key] ?? '';
                return (
                  <tr key={key}>
                    <td>
                      <span className="badge bg-danger-subtle text-danger-emphasis fw-semibold" dir="auto">
                        {entry.value}
                      </span>
                    </td>
                    <td className="small text-body-secondary">
                      {fieldLabel(entry.field)}
                      <div className="text-body-tertiary" style={{ fontSize: '.72rem' }}>
                        {entry.column}
                      </div>
                    </td>
                    <td className="text-center fw-semibold">{entry.count}</td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={picked}
                        onChange={(event) =>
                          setChoice((current) => ({ ...current, [key]: event.target.value }))
                        }
                      >
                        <option value="">— {t('imports.fix.choose')} —</option>
                        {options[entry.field].map((option) => (
                          <option key={option.id} value={option.code}>
                            {localisedName(option, i18n.language)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary text-nowrap"
                        disabled={!picked || fix.isPending}
                        onClick={() =>
                          fix.mutate({
                            replace: [{ column: entry.column, from: entry.value, to: picked }],
                          })
                        }
                      >
                        {t('imports.fix.applyTo', { count: entry.count })}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {['product', 'investigationType'].map((field) =>
        missing[field] > 0 ? (
          <MissingDefault
            key={field}
            label={t(`imports.fix.missing.${field}`, { count: missing[field] })}
            options={options[field]}
            busy={fix.isPending}
            onApply={(id) =>
              fix.mutate(
                field === 'product'
                  ? { defaultProductId: id }
                  : { defaultInvestigationTypeId: id },
              )
            }
          />
        ) : null,
      )}
    </Panel>
  );
}

function MissingDefault({ label, options, busy, onApply }) {
  const { t, i18n } = useTranslation();
  const [picked, setPicked] = useState('');
  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mb-2 fix-missing">
      <span className="small fw-semibold">
        <i className="bi bi-exclamation-circle text-danger me-1" aria-hidden="true" />
        {label}
      </span>
      <select
        className="form-select form-select-sm"
        style={{ width: 'auto', minWidth: 200 }}
        value={picked}
        onChange={(event) => setPicked(event.target.value)}
      >
        <option value="">— {t('imports.fix.choose')} —</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {localisedName(option, i18n.language)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={!picked || busy}
        onClick={() => onApply(picked)}
      >
        {t('imports.fix.setDefault')}
      </button>
    </div>
  );
}

/**
 * Edit one staged row's cells, as they are in the file, then re-check it.
 *
 * Shows every column the import reads (the mapping, plus the client's own
 * fields), with the row's problems beside the cells they are about. Product
 * and type offer the catalogue as suggestions, but anything can be typed —
 * the server decides what it matches.
 *
 * @param {{ batch: object, row: object|null, client?: object|null, onClose: () => void, onFixed: (batch: object) => void }} props
 */
export function RowEditModal({ batch, row, client, onClose, onFixed }) {
  const { t, i18n } = useTranslation();
  const { data: allProducts } = useProducts();
  const { data: allTypes } = useInvestigationTypes();
  const fix = useFix(batch.id, (updated) => {
    onFixed(updated);
    onClose();
  });

  // The columns this import reads: mapped system fields, then client-only.
  const columns = useMemo(() => {
    const mapping = batch.mappingUsed ?? {};
    const list = Object.entries(mapping).map(([field, column]) => ({ field, column }));
    for (const field of client?.templateFields ?? []) {
      if (!field.target && !list.some((item) => item.column === field.header)) {
        list.push({ field: null, column: field.header });
      }
    }
    return list;
  }, [batch.mappingUsed, client]);

  const [values, setValues] = useState(() =>
    Object.fromEntries(
      columns.map(({ column }) => [column, cellText(row?.rawData?.[column])]),
    ),
  );

  if (!row) return null;

  const problemsFor = (column, field) =>
    [...(row.errors ?? []), ...(row.warnings ?? [])].filter(
      (problem) => problem.column === column || (field && problem.field === field),
    );

  const suggestions = {
    product: within(allProducts, client?.productIds),
    investigationType: within(allTypes, client?.investigationTypeIds),
  };

  const changed = columns
    .filter(({ column }) => values[column] !== cellText(row.rawData?.[column]))
    .map(({ column }) => ({ rowNumber: row.rowNumber, column, value: values[column] ?? '' }));

  return (
    <Modal
      open
      onClose={onClose}
      size="modal-lg"
      busy={fix.isPending}
      title={t('imports.fix.editRow', { row: row.rowNumber })}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={changed.length === 0 || fix.isPending}
            onClick={() => fix.mutate({ cells: changed })}
          >
            {fix.isPending && (
              <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
            )}
            {t('imports.fix.saveRow')}
          </button>
        </>
      }
    >
      <p className="small text-body-secondary">{t('imports.fix.editHint')}</p>
      <div className="row g-3">
        {columns.map(({ field, column }) => {
          const problems = problemsFor(column, field);
          const listId = suggestions[field] ? `fix-${row.rowNumber}-${field}` : undefined;
          return (
            <div className="col-12 col-md-6" key={column}>
              <label className="form-label small fw-semibold mb-1" htmlFor={`fix-${column}`}>
                {column}
              </label>
              <input
                id={`fix-${column}`}
                className={`form-control form-control-sm ${
                  problems.some((problem) => (row.errors ?? []).includes(problem)) ? 'is-invalid' : ''
                }`}
                dir="auto"
                list={listId}
                value={values[column] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [column]: event.target.value }))
                }
              />
              {listId && (
                <datalist id={listId}>
                  {suggestions[field].map((option) => (
                    <option key={option.id} value={localisedName(option, i18n.language)} />
                  ))}
                </datalist>
              )}
              {problems.map((problem, index) => (
                <div
                  key={index}
                  className={`small mt-1 ${
                    (row.errors ?? []).includes(problem) ? 'text-danger' : 'text-warning-emphasis'
                  }`}
                >
                  {i18n.language === 'ar' ? problem.reasonAr : problem.reasonEn}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function cellText(cell) {
  if (cell === null || cell === undefined) return '';
  return String(cell);
}

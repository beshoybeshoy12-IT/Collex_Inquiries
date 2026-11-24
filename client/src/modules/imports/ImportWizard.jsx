import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useProducts, useInvestigationTypes } from '../../hooks/useCatalog';
import PageHeader, { Panel } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { StateBadge } from '../../components/Badges';
import { saveErrorMessage, saveFromApi } from '../../utils/saveFromApi';
import ClientLogo from '../clients/ClientLogo';
import { FixPanel, RowEditModal } from './ImportFixes';
import { useAuth } from '../../app/AuthContext';
import { ConfirmDialog } from '../../components/Modal';
import { P } from '../../utils/permissions';

/** Headers compare as the same column regardless of case and spacing. */
const headerKey = (header) => String(header).trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * A client's template, matched against the headers actually in the file:
 * `{ mapping, missing }` — the mapping for the columns found, and the client
 * columns the file does not have.
 */
function clientMapping(client, headers) {
  const byKey = new Map(headers.map((header) => [headerKey(header), header]));
  const mapping = {};
  const missing = [];
  for (const field of client.templateFields ?? []) {
    const found = byKey.get(headerKey(field.header));
    if (!found) missing.push(field.header);
    else if (field.target) mapping[field.target] = found;
  }
  return { mapping, missing };
}

const STEPS = ['upload', 'map', 'preview', 'confirm'];

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The Excel import wizard.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *      upload → map columns → preview → confirm
 *
 *  NOTHING IS WRITTEN UNTIL THE USER CONFIRMS. Step 1 reads the file and
 *  proposes a mapping while storing nothing at all — so a coordinator can open
 *  a file, see what is in it, and change their mind without leaving a
 *  half-made batch behind. Step 2 stages the rows and validates them. Only
 *  step 4 creates customers and cases.
 *
 *  THE PREVIEW SHOWS THE USER THEIR OWN SPREADSHEET with the problems marked
 *  in place, because the person fixing it is looking at the original file. A
 *  summary saying "412 rows failed" is not something anybody can act on.
 *
 *  INSIDE A CLIENT (`client` given) the client's template is the mapping:
 *  its columns are matched by name, its defaults pre-fill the product and
 *  type, and every case created belongs to it.
 *
 * @param {{ client?: object }} props
 */
export default function ImportWizard({ client = null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const save = (path, fileName) =>
    saveFromApi(path, { fileName }).catch(async (error) =>
      toast.error(localiseServerMessage(await saveErrorMessage(error, t))),
    );
  const queryClient = useQueryClient();
  const fileInput = useRef(null);

  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [inspection, setInspection] = useState(null);
  const [mapping, setMapping] = useState({});
  const [sheetName, setSheetName] = useState('');
  // The API and the parser both accept a header row below the first — a bank
  // file with a title block above its headers needs it. NO CONTROL EXPOSES IT
  // YET, so this is a constant rather than state pretending to be adjustable.
  // Wiring a number input in step 1 is all that is missing.
  const headerRow = 1;
  const [defaults, setDefaults] = useState({
    // A client limited to one product / type has, in effect, a default.
    defaultProductId: client?.productIds?.length === 1 ? client.productIds[0] : '',
    defaultInvestigationTypeId:
      client?.investigationTypeIds?.length === 1 ? client.investigationTypeIds[0] : '',
    defaultPriority: 'NORMAL',
  });
  const [missingColumns, setMissingColumns] = useState([]);
  const [batch, setBatch] = useState(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);

  const { data: allProducts } = useProducts();
  const { data: allTypes } = useInvestigationTypes();
  // Inside a client, only what the client has (an empty list means all).
  const within = (list, ids) =>
    ids?.length ? (list ?? []).filter((item) => ids.includes(item.id)) : list;
  const products = within(allProducts, client?.productIds);
  const types = within(allTypes, client?.investigationTypeIds);

  const { data: savedMappings } = useQuery({
    queryKey: ['import-mappings'],
    queryFn: async () => (await api.get('/imports/mappings/all')).data,
    // Inside a client its template is the mapping; the saved ones do not apply.
    enabled: !client,
  });

  // ── Step 1: inspect ───────────────────────────────────────────────────────
  const inspect = useMutation({
    mutationFn: async (chosen) => {
      const body = new FormData();
      body.append('file', chosen);
      if (sheetName) body.append('sheetName', sheetName);
      body.append('headerRow', String(headerRow));

      return (
        await api.post('/imports/inspect', body, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      ).data;
    },
    onSuccess: (result) => {
      setInspection(result);
      setSheetName(result.sheetName);
      if (client) {
        const matched = clientMapping(client, result.headers ?? []);
        // The client's columns first; the alias guess fills only what the
        // template does not cover.
        setMapping({ ...(result.suggestedMapping ?? {}), ...matched.mapping });
        setMissingColumns(matched.missing);
      } else {
        setMapping(result.suggestedMapping ?? {});
      }
      setStep(1);
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  // ── Step 2: prepare (stage + validate) ───────────────────────────────────
  const prepare = useMutation({
    mutationFn: async () => {
      const body = new FormData();
      body.append('file', file);
      body.append('sheetName', sheetName);
      body.append('headerRow', String(headerRow));
      body.append('mapping', JSON.stringify(mapping));
      if (client) body.append('clientAccountId', client.id);
      if (defaults.defaultProductId)
        body.append('defaultProductId', defaults.defaultProductId);
      if (defaults.defaultInvestigationTypeId)
        body.append('defaultInvestigationTypeId', defaults.defaultInvestigationTypeId);
      if (defaults.defaultPriority)
        body.append('defaultPriority', defaults.defaultPriority);

      return (
        await api.post('/imports/prepare', body, {
          headers: { 'Content-Type': 'multipart/form-data' },
          // Parsing and validating fifty thousand rows takes longer than the
          // default timeout allows for.
          timeout: 180_000,
        })
      ).data;
    },
    onSuccess: (result) => {
      setBatch(result.batch);
      setStep(2);
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  // ── Step 4: confirm ──────────────────────────────────────────────────────
  const confirm = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/imports/${batch.id}/confirm`, { includeDuplicates })
      ).data,
    onSuccess: (result) => {
      toast.success(t('imports.imported', { count: result.imported }));
      if (result.failed > 0) {
        toast.warning(t('imports.importFailed', { count: result.failed }));
      }
      queryClient.invalidateQueries({ queryKey: ['investigations'] });
      queryClient.invalidateQueries({ queryKey: ['investigation-counts'] });
      navigate(`/imports/${batch.id}`);
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const chooseFile = (chosen) => {
    if (!chosen) return;
    setFile(chosen);
    inspect.mutate(chosen);
  };

  // A column mapped to two fields would silently lose one of them; the server
  // rejects it, and flagging it here is faster than a round trip.
  const duplicateColumns = useMemo(() => {
    const used = Object.values(mapping).filter(Boolean);
    return new Set(used.filter((column, index) => used.indexOf(column) !== index));
  }, [mapping]);

  // Columns nothing will read — not linked here and not in the client's
  // template. They are not lost: the server keeps them on each case as extra
  // information. A warning, never a block.
  const extraHeaders = useMemo(() => {
    if (!inspection) return [];
    const used = new Set(
      [
        ...Object.values(mapping),
        ...(client?.templateFields ?? []).filter((field) => !field.target).map((field) => field.header),
      ].map(headerKey),
    );
    return (inspection.headers ?? []).filter((header) => header && !used.has(headerKey(header)));
  }, [inspection, mapping, client]);

  // What must be fixed before upload, because it would write a wrong or
  // incomplete case. Shown next to the button, so a disabled "Next" says why.
  const blockers = [
    Object.keys(mapping).length === 0 && t('imports.block.nothingMapped'),
    duplicateColumns.size > 0 && t('imports.block.duplicateColumns'),
    !mapping.fullName && t('imports.block.noName'),
    !(mapping.product || defaults.defaultProductId) && t('imports.block.noProduct'),
    !(mapping.investigationType || defaults.defaultInvestigationTypeId) && t('imports.block.noType'),
  ].filter(Boolean);
  const canPrepare = blockers.length === 0;

  return (
    <>
      <PageHeader
        title={
          client ? (
            <span className="d-inline-flex align-items-center gap-2">
              <BackButton
                onClick={() =>
                  step > 0 ? setStep(step - 1) : navigate(`/clients/${client.id}`)
                }
              />
              <ClientLogo client={client} size={32} />
              {t('clients.importInto', { name: localisedName(client, i18n.language) })}
            </span>
          ) : (
            <span className="d-inline-flex align-items-center gap-2">
              <BackButton onClick={() => (step > 0 ? setStep(step - 1) : navigate(-1))} />
              {t('imports.title')}
            </span>
          )
        }
        actions={
          client ? (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() =>
                save(
                  `/clients/${client.id}/template?lang=${i18n.language === 'en' ? 'en' : 'ar'}`,
                  t('clients.templateFileName', { name: localisedName(client, i18n.language) }),
                )
              }
            >
              <i className="bi bi-download me-1" aria-hidden="true" />
              {t('clients.downloadTemplate')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => save('/imports/template', 'collex-import-template.xlsx')}
            >
              <i className="bi bi-download me-1" aria-hidden="true" />
              {t('imports.downloadTemplate')}
            </button>
          )
        }
      />

      <ol className="wizard-steps">
        {STEPS.map((name, index) => (
          <li
            key={name}
            className={index === step ? 'active' : index < step ? 'done' : ''}
          >
            <span className="me-1">{index + 1}.</span>
            {t(`imports.steps.${name}`)}
          </li>
        ))}
      </ol>

      {/* ── 1. Upload ─────────────────────────────────────────────────────── */}
      {step === 0 && (
        <Panel>
          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              chooseFile(event.dataTransfer.files?.[0]);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') fileInput.current?.click();
            }}
          >
            {inspect.isPending ? (
              <>
                <span className="spinner-border text-primary" aria-hidden="true" />
                <p className="mt-3 mb-0 small">{t('app.loading')}</p>
              </>
            ) : (
              <>
                <i
                  className="bi bi-file-earmark-arrow-up text-body-tertiary"
                  style={{ fontSize: '2.5rem' }}
                  aria-hidden="true"
                />
                <p className="fw-semibold mt-3 mb-1">{t('imports.chooseFile')}</p>
                <p className="text-body-secondary small mb-0">{t('imports.dropHint')}</p>
                {client && (
                  <p className="text-body-secondary small mt-2 mb-0">
                    <i className="bi bi-buildings me-1" aria-hidden="true" />
                    {t('clients.uploadBelongs', { name: localisedName(client, i18n.language) })}
                  </p>
                )}
              </>
            )}
          </div>

          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="d-none"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />

          {savedMappings?.length > 0 && (
            <div className="mt-3 small text-body-secondary">
              <i className="bi bi-info-circle me-1" aria-hidden="true" />
              {t('imports.useMapping')}:{' '}
              {savedMappings.map((template) => localisedName(template, i18n.language)).join(', ')}
            </div>
          )}
        </Panel>
      )}

      {/* ── 2. Map ────────────────────────────────────────────────────────── */}
      {step === 1 && inspection && (
        <>
          <Panel className="mb-3">
            <div className="d-flex flex-wrap gap-3 align-items-end">
              <div>
                <label className="form-label small fw-semibold">{t('imports.sheet')}</label>
                <select
                  className="form-select form-select-sm"
                  value={sheetName}
                  onChange={(event) => {
                    setSheetName(event.target.value);
                    inspect.mutate(file);
                  }}
                >
                  {inspection.sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label small fw-semibold">
                  {t('imports.totalRows')}
                </label>
                <div className="fs-5 fw-semibold">{inspection.totalRows}</div>
              </div>

              {savedMappings?.length > 0 && (
                <div>
                  <label className="form-label small fw-semibold">
                    {t('imports.useMapping')}
                  </label>
                  <select
                    className="form-select form-select-sm"
                    onChange={(event) => {
                      const template = savedMappings.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      if (template) setMapping(template.mapping);
                    }}
                    defaultValue=""
                  >
                    <option value="">—</option>
                    {savedMappings.map((template) => (
                      <option key={template.id} value={template.id}>
                        {localisedName(template, i18n.language)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </Panel>

          <div className="row g-3">
            <div className="col-12 col-lg-7">
              <Panel title={t('imports.mapColumns')}>
                <p className="small text-body-secondary">
                  {client ? t('clients.mapHint') : t('imports.mapHint')}
                </p>
                {missingColumns.length > 0 && (
                  <div className="alert alert-warning py-2 px-3 small">
                    <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                    {t('clients.missingColumns')}: <strong>{missingColumns.join('، ')}</strong>
                  </div>
                )}

                <div className="table-responsive" style={{ maxHeight: 420 }}>
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr>
                        <th>{t('imports.systemField')}</th>
                        <th>{t('imports.excelColumn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inspection.fields.map((field) => (
                        <tr key={field.key}>
                          <td>
                            <span className={field.required ? 'fw-semibold' : ''}>
                              {i18n.language === 'ar' ? field.labelAr : field.labelEn}
                            </span>
                            {field.required && <span className="text-danger ms-1">*</span>}
                            {field.hintEn && (
                              <div
                                className="text-body-tertiary"
                                style={{ fontSize: '.72rem' }}
                              >
                                {i18n.language === 'ar' ? field.hintAr : field.hintEn}
                              </div>
                            )}
                          </td>
                          <td>
                            <select
                              className={`form-select form-select-sm ${
                                duplicateColumns.has(mapping[field.key])
                                  ? 'is-invalid'
                                  : ''
                              }`}
                              value={mapping[field.key] ?? ''}
                              onChange={(event) =>
                                setMapping((current) => {
                                  const next = { ...current };
                                  if (event.target.value) next[field.key] = event.target.value;
                                  else delete next[field.key];
                                  return next;
                                })
                              }
                            >
                              <option value="">— {t('imports.unmapped')} —</option>
                              {inspection.headers.map((header) => (
                                <option key={header} value={header}>
                                  {header}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {duplicateColumns.size > 0 && (
                  <div className="alert alert-danger py-2 px-3 small mb-0">
                    {[...duplicateColumns].join(', ')}
                  </div>
                )}
              </Panel>
            </div>

            <div className="col-12 col-lg-5">
              <Panel title={t('imports.defaults')} className="mb-3">
                <div className="mb-2">
                  <label className="form-label small fw-semibold">
                    {t('imports.defaultProduct')}
                    {!mapping.product && <span className="text-danger ms-1">*</span>}
                  </label>
                  <select
                    className="form-select form-select-sm"
                    value={defaults.defaultProductId}
                    onChange={(event) =>
                      setDefaults((current) => ({
                        ...current,
                        defaultProductId: event.target.value,
                      }))
                    }
                  >
                    <option value="">—</option>
                    {(products ?? []).map((product) => (
                      <option key={product.id} value={product.id}>
                        {localisedName(product, i18n.language)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-2">
                  <label className="form-label small fw-semibold">
                    {t('imports.defaultType')}
                    {!mapping.investigationType && (
                      <span className="text-danger ms-1">*</span>
                    )}
                  </label>
                  <select
                    className="form-select form-select-sm"
                    value={defaults.defaultInvestigationTypeId}
                    onChange={(event) =>
                      setDefaults((current) => ({
                        ...current,
                        defaultInvestigationTypeId: event.target.value,
                      }))
                    }
                  >
                    <option value="">—</option>
                    {(types ?? []).map((type) => (
                      <option key={type.id} value={type.id}>
                        {localisedName(type, i18n.language)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label small fw-semibold">
                    {t('imports.defaultPriority')}
                  </label>
                  <select
                    className="form-select form-select-sm"
                    value={defaults.defaultPriority}
                    onChange={(event) =>
                      setDefaults((current) => ({
                        ...current,
                        defaultPriority: event.target.value,
                      }))
                    }
                  >
                    {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((priority) => (
                      <option key={priority} value={priority}>
                        {t(`priority.${priority}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </Panel>

              {extraHeaders.length > 0 && (
                <Panel
                  title={
                    <span className="text-warning-emphasis">
                      <i className="bi bi-info-circle me-1" aria-hidden="true" />
                      {t('imports.extraTitle', { count: extraHeaders.length })}
                    </span>
                  }
                >
                  <p className="small text-body-secondary">
                    {client ? t('imports.extraHintClient') : t('imports.extraHint')}
                  </p>
                  <div className="d-flex flex-wrap gap-1">
                    {extraHeaders.map((header) => (
                      <span key={header} className="badge bg-warning-subtle extra-col">
                        {header}
                      </span>
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          </div>

          {blockers.length > 0 && (
            <div className="alert alert-danger py-2 px-3 small mt-3 mb-0">
              <div className="fw-semibold mb-1">
                <i className="bi bi-exclamation-octagon me-1" aria-hidden="true" />
                {t('imports.block.title')}
              </div>
              <ul className="mb-0 ps-3">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="d-flex justify-content-between mt-3">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setStep(0)}
            >
              {t('common.back')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => prepare.mutate()}
              disabled={!canPrepare || prepare.isPending}
            >
              {prepare.isPending && (
                <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              )}
              {t('common.next')}
            </button>
          </div>
        </>
      )}

      {/* ── 3. Preview ────────────────────────────────────────────────────── */}
      {step === 2 && batch && (
        <PreviewStep
          batch={batch}
          client={client}
          onBatchChange={setBatch}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      )}

      {/* ── 4. Confirm ────────────────────────────────────────────────────── */}
      {step === 3 && batch && (
        <Panel>
          <h2 className="h6">{t('imports.steps.confirm')}</h2>

          <div className="row g-3 my-2">
            <SummaryTile label={t('imports.totalRows')} value={batch.totalRows} />
            <SummaryTile
              label={t('imports.validRows')}
              value={batch.validRows}
              tone="success"
            />
            <SummaryTile
              label={t('imports.duplicateRows')}
              value={batch.duplicateRows}
              tone="warning"
            />
            <SummaryTile
              label={t('imports.invalidRows')}
              value={batch.invalidRows}
              tone="danger"
            />
          </div>

          {batch.duplicateRows > 0 && (
            <div className="form-check mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                id="include-duplicates"
                checked={includeDuplicates}
                onChange={(event) => setIncludeDuplicates(event.target.checked)}
              />
              <label className="form-check-label small" htmlFor="include-duplicates">
                {t('imports.includeDuplicates')}
              </label>
            </div>
          )}

          {batch.invalidRows > 0 && (
            <div className="alert alert-warning py-2 px-3 small">
              {t('imports.errorReportHint')}
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary ms-2"
                onClick={() =>
                  save(`/imports/${batch.id}/error-report`, `${batch.reference}-errors.xlsx`)
                }
              >
                {t('imports.downloadErrors')}
              </button>
            </div>
          )}

          <div className="d-flex justify-content-between">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setStep(2)}
            >
              {t('common.back')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => confirm.mutate()}
              disabled={confirm.isPending}
            >
              {confirm.isPending && (
                <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
              )}
              {t('imports.confirmImport', {
                count:
                  batch.validRows + (includeDuplicates ? batch.duplicateRows : 0),
              })}
            </button>
          </div>
        </Panel>
      )}
    </>
  );
}

function SummaryTile({ label, value, tone }) {
  return (
    <div className="col-6 col-md-3">
      <div className="stat-card">
        <div className="stat-card__label">{label}</div>
        <div className={`stat-card__value ${tone ? `text-${tone}` : ''}`}>{value ?? 0}</div>
      </div>
    </div>
  );
}

/**
 * The staged rows, with each problem shown against the cell it came from.
 *
 * Defaults to the rows that failed, because those are the only ones the user
 * has to do anything about — opening on 4,800 valid rows buries the 12 that
 * need attention.
 */
function PreviewStep({ batch, client, onBatchChange, onBack, onContinue }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const canAccept = can(P.IMPORTS_RESOLVE_DUPLICATES);
  const [status, setStatus] = useState(batch.invalidRows > 0 ? 'INVALID' : '');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);

  // A fix re-checks the batch: take the new counts and reload the rows.
  const onFixed = (updated) => {
    onBatchChange({ ...batch, ...updated });
    queryClient.invalidateQueries({ queryKey: ['import-rows', batch.id] });
  };

  // "Not a problem": a flagged duplicate is a real second inquiry. The row is
  // imported as it is; the flag stays on record as the user's decision.
  const accept = useMutation({
    mutationFn: async (rowNumbers) => {
      let numbers = rowNumbers;
      if (numbers === 'all') {
        numbers = [];
        for (let pageNo = 1; ; pageNo++) {
          const result = (
            await api.get(`/imports/${batch.id}/rows`, {
              params: { status: 'DUPLICATE', page: pageNo, limit: 200 },
            })
          ).data;
          numbers.push(...result.data.map((row) => row.rowNumber));
          if (!result.meta?.hasNext) break;
        }
      }
      await api.post(`/imports/${batch.id}/resolve-duplicates`, {
        resolutions: numbers.map((rowNumber) => ({ rowNumber, action: 'CREATE_ANYWAY' })),
      });
      return (await api.get(`/imports/${batch.id}`)).data;
    },
    onSuccess: (updated) => {
      onFixed(updated);
      toast.success(t('imports.dup.accepted'));
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  // "Delete": leave rows out of this import and carry on with the rest. They
  // stay staged as skipped, so the batch still shows what the file held.
  const [confirmDropAll, setConfirmDropAll] = useState(false);
  const drop = useMutation({
    mutationFn: async (body) => (await api.post(`/imports/${batch.id}/fix`, body)).data,
    onSuccess: (updated) => {
      onFixed(updated);
      setConfirmDropAll(false);
      toast.success(t('imports.drop.done'));
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const ruleText = (match) =>
    match.rule === 'IN_FILE'
      ? t('imports.dup.IN_FILE', { row: match.rowNumber })
      : i18n.exists(`imports.dup.${match.rule}`)
        ? t(`imports.dup.${match.rule}`)
        : match.rule;

  const { data, isLoading } = useQuery({
    queryKey: ['import-rows', batch.id, status, page],
    queryFn: async () =>
      (
        await api.get(`/imports/${batch.id}/rows`, {
          params: { status: status || undefined, page, limit: 25 },
        })
      ).data,
  });

  const summary = batch.errorSummary;

  return (
    <>
      <div className="row g-3 mb-3">
        <SummaryTile label={t('imports.totalRows')} value={batch.totalRows} />
        <SummaryTile label={t('imports.validRows')} value={batch.validRows} tone="success" />
        <SummaryTile
          label={t('imports.duplicateRows')}
          value={batch.duplicateRows}
          tone="warning"
        />
        <SummaryTile
          label={t('imports.invalidRows')}
          value={batch.invalidRows}
          tone="danger"
        />
      </div>

      <FixPanel batch={batch} client={client} onFixed={onFixed} />

      {summary?.topErrors?.length > 0 && (
        <Panel title={t('imports.topErrors')} className="mb-3">
          <ul className="list-unstyled mb-0 small">
            {summary.topErrors.map((entry, index) => (
              <li key={index} className="d-flex justify-content-between py-1">
                <span>
                  <span className="badge text-bg-light me-2">{entry.column}</span>
                  {entry.reason}
                </span>
                <span className="fw-semibold">{entry.count}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title={t('imports.steps.preview')}
        actions={
          <div className="d-flex gap-2">
          {batch.invalidRows > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger text-nowrap"
              disabled={drop.isPending}
              onClick={() => setConfirmDropAll(true)}
            >
              <i className="bi bi-trash3 me-1" aria-hidden="true" />
              {t('imports.drop.allInvalid', { count: batch.invalidRows })}
            </button>
          )}
          {canAccept && batch.duplicateRows > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-outline-success text-nowrap"
              disabled={accept.isPending}
              onClick={() => accept.mutate('all')}
            >
              <i className="bi bi-check2-all me-1" aria-hidden="true" />
              {t('imports.dup.acceptAll', { count: batch.duplicateRows })}
            </button>
          )}
          <select
            className="form-select form-select-sm"
            style={{ width: 'auto' }}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            {['VALID', 'INVALID', 'DUPLICATE'].map((value) => (
              <option key={value} value={value}>
                {t(`importRowStatus.${value}`)}
              </option>
            ))}
          </select>
          </div>
        }
      >
        {isLoading ? (
          <span className="placeholder col-12 d-block" style={{ height: 200 }} />
        ) : (
          <div className="table-responsive" style={{ maxHeight: 420 }}>
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>{t('imports.row')}</th>
                  <th style={{ width: 120 }}>{t('common.status')}</th>
                  <th>{t('customers.customer')}</th>
                  <th>{t('imports.problems')}</th>
                  <th style={{ width: 260 }} />
                </tr>
              </thead>
              <tbody>
                {(data?.data ?? []).map((row) => (
                  <tr
                    key={row.id}
                    className={
                      row.status === 'INVALID'
                        ? 'import-row import-row--danger'
                        : row.status === 'DUPLICATE'
                          ? 'import-row import-row--warning'
                          : undefined
                    }
                  >
                    <td className="mono">{row.rowNumber}</td>
                    <td>
                      <StateBadge value={row.status} namespace="importRowStatus" />
                    </td>
                    <td className="small">
                      {row.mappedData?.fullName ?? '—'}
                      {row.mappedData?.nationalId && (
                        <span className="mono text-body-secondary ms-2">
                          {row.mappedData.nationalId}
                        </span>
                      )}
                    </td>
                    <td className="small">
                      {(row.errors ?? []).map((problem, index) => (
                        <div key={index} className="text-danger">
                          <span className="badge text-bg-light me-1">
                            {problem.column ?? problem.field}
                          </span>
                          {i18n.language === 'ar' ? problem.reasonAr : problem.reasonEn}
                        </div>
                      ))}
                      {(row.warnings ?? []).map((problem, index) => (
                        <div key={`w${index}`} className="text-warning-emphasis">
                          <span className="badge text-bg-light me-1">
                            {problem.column ?? problem.field}
                          </span>
                          {i18n.language === 'ar' ? problem.reasonAr : problem.reasonEn}
                        </div>
                      ))}
                      {row.duplicateOf?.length > 0 && (
                        <div className="text-warning-emphasis">
                          <i className="bi bi-copy me-1" aria-hidden="true" />
                          {row.duplicateOf.map(ruleText).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="text-end">
                      <div className="d-inline-flex gap-1">
                        {row.status === 'DUPLICATE' && canAccept && (
                          <button
                            type="button"
                            className="btn btn-sm btn-success text-nowrap"
                            disabled={accept.isPending}
                            onClick={() => accept.mutate([row.rowNumber])}
                            title={t('imports.dup.acceptHint')}
                          >
                            <i className="bi bi-check2 me-1" aria-hidden="true" />
                            {t('imports.dup.accept')}
                          </button>
                        )}
                        {row.status !== 'VALID' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary text-nowrap"
                            onClick={() => setEditing(row)}
                          >
                            <i className="bi bi-pencil me-1" aria-hidden="true" />
                            {t('common.edit')}
                          </button>
                        )}
                        {row.status !== 'VALID' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger text-nowrap"
                            disabled={drop.isPending}
                            onClick={() => drop.mutate({ skipRows: [row.rowNumber] })}
                            title={t('imports.drop.rowHint')}
                          >
                            <i className="bi bi-trash3 me-1" aria-hidden="true" />
                            {t('common.delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data?.meta && data.meta.totalPages > 1 && (
          <div className="d-flex justify-content-between align-items-center pt-2 small">
            <span className="text-body-secondary">
              {t('common.showing', {
                from: (data.meta.page - 1) * data.meta.limit + 1,
                to: Math.min(data.meta.page * data.meta.limit, data.meta.total),
                total: data.meta.total,
              })}
            </span>
            <div className="btn-group btn-group-sm">
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={!data.meta.hasPrev}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('common.previous')}
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={!data.meta.hasNext}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('common.next')}
              </button>
            </div>
          </div>
        )}
      </Panel>

      <div className="d-flex justify-content-between mt-3">
        <button type="button" className="btn btn-outline-secondary" onClick={onBack}>
          {t('common.back')}
        </button>
        <div className="d-flex align-items-center gap-2">
          {batch.invalidRows > 0 && batch.validRows + batch.duplicateRows > 0 && (
            <span className="small text-body-secondary d-none d-md-inline">
              {t('imports.fix.skipNote', { count: batch.invalidRows })}
            </span>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={onContinue}
            disabled={batch.validRows === 0 && batch.duplicateRows === 0}
          >
            {batch.invalidRows > 0
              ? t('imports.fix.continueValid', { count: batch.validRows + batch.duplicateRows })
              : t('common.next')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDropAll}
        onClose={() => setConfirmDropAll(false)}
        onConfirm={() => drop.mutate({ skipInvalid: true })}
        title={t('imports.drop.allInvalid', { count: batch.invalidRows })}
        message={t('imports.drop.confirm', { count: batch.invalidRows })}
        confirmLabel={t('common.delete')}
        busy={drop.isPending}
      />

      {editing && (
        <RowEditModal
          key={editing.id}
          batch={batch}
          row={editing}
          client={client}
          onClose={() => setEditing(null)}
          onFixed={onFixed}
        />
      )}
    </>
  );
}

/** A step back, drawn as an arrow beside the title — it points the reading way. */
function BackButton({ onClick }) {
  const { t, i18n } = useTranslation();
  return (
    <button
      type="button"
      className="btn btn-sm btn-icon back-step"
      onClick={onClick}
      aria-label={t('common.back')}
      title={t('common.back')}
    >
      <i
        className={`bi ${i18n.dir() === 'rtl' ? 'bi-arrow-right' : 'bi-arrow-left'}`}
        aria-hidden="true"
      />
    </button>
  );
}

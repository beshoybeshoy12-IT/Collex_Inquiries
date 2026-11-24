import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import { useAuth } from '../../app/AuthContext';
import { P } from '../../utils/permissions';
import PageHeader, { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { StateBadge } from '../../components/Badges';
import { useClient } from '../../hooks/useClients';
import { useProducts, useInvestigationTypes } from '../../hooks/useCatalog';
import { saveErrorMessage, saveFromApi } from '../../utils/saveFromApi';
import ClientLogo from './ClientLogo';
import MultiSelectAll from '../../components/MultiSelectAll';

/** Picked as a starting point by "Add the basic fields". */
const BASIC_FIELDS = ['fullName', 'nationalId', 'mobile', 'residenceAddress', 'applicationNumber'];

let localId = 0;
const nextId = () => `row-${++localId}`;

const EMPTY_FORM = {
  nameAr: '',
  nameEn: '',
  contactEmail: '',
  contactPhone: '',
  productIds: [],
  investigationTypeIds: [],
};

/**
 * Create or edit one client: its names and logo, the defaults its uploads
 * use, and its inquiry template — the columns of its file, in its order and
 * under its own names, each linked to a system field or kept as a field only
 * this client has.
 */
export default function ClientEditor() {
  const { id } = useParams();
  const isNew = !id;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can(P.CLIENTS_MANAGE);
  const logoInput = useRef(null);

  const { data: client, isLoading, error, refetch } = useClient(id);
  const { data: products } = useProducts();
  const { data: types } = useInvestigationTypes();
  const { data: systemFields } = useQuery({
    queryKey: ['import-fields'],
    queryFn: async () => (await api.get('/imports/fields')).data,
    staleTime: Infinity,
  });

  const [form, setForm] = useState(EMPTY_FORM);
  const [rows, setRows] = useState([]);
  const [problems, setProblems] = useState([]);
  const [pendingLogo, setPendingLogo] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Load the saved client into the form once it arrives.
  useEffect(() => {
    if (!client) return;
    setForm({
      nameAr: client.nameAr ?? '',
      nameEn: client.nameEn ?? '',
      contactEmail: client.contactEmail ?? '',
      contactPhone: client.contactPhone ?? '',
      productIds: client.productIds ?? [],
      investigationTypeIds: client.investigationTypeIds ?? [],
    });
    setRows((client.templateFields ?? []).map((field) => ({ ...field, uid: nextId() })));
    setProblems([]);
  }, [client]);

  const pendingLogoUrl = useMemo(
    () => (pendingLogo ? URL.createObjectURL(pendingLogo) : null),
    [pendingLogo],
  );
  useEffect(() => () => pendingLogoUrl && URL.revokeObjectURL(pendingLogoUrl), [pendingLogoUrl]);

  const fieldLabel = (key) => {
    const field = (systemFields ?? []).find((candidate) => candidate.key === key);
    if (!field) return key;
    return i18n.language === 'en' ? field.labelEn : field.labelAr;
  };

  const usedTargets = new Set(rows.map((row) => row.target).filter(Boolean));

  const refresh = (saved) => {
    queryClient.setQueryData(['client', saved.id], saved);
    queryClient.invalidateQueries({ queryKey: ['clients'] });
  };

  const uploadLogo = useMutation({
    mutationFn: async ({ clientId, file }) => {
      const body = new FormData();
      body.append('file', file);
      return (await api.post(`/clients/${clientId}/logo`, body)).data;
    },
    onSuccess: (saved) => {
      refresh(saved);
      setPendingLogo(null);
    },
    onError: (failure) => toast.error(localiseServerMessage(failure.friendlyMessage)),
  });

  const removeLogo = useMutation({
    mutationFn: async () => (await api.delete(`/clients/${id}/logo`)).data,
    onSuccess: refresh,
    onError: (failure) => toast.error(localiseServerMessage(failure.friendlyMessage)),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        templateFields: rows.map(({ key, header, target, required }) => ({
          ...(key ? { key } : {}),
          header,
          target: target || null,
          required: Boolean(required),
        })),
      };
      return isNew
        ? (await api.post('/clients', body)).data
        : (await api.patch(`/clients/${id}`, body)).data;
    },
    onSuccess: async (saved) => {
      setProblems([]);
      refresh(saved);
      if (isNew && pendingLogo) {
        await uploadLogo.mutateAsync({ clientId: saved.id, file: pendingLogo }).catch(() => {});
      }
      toast.success(t('clients.saved'));
      if (isNew) navigate(`/clients/${saved.id}`, { replace: true });
    },
    onError: (failure) => {
      const list = failure.response?.data?.problems;
      if (Array.isArray(list)) setProblems(list);
      toast.error(localiseServerMessage(failure.friendlyMessage));
    },
  });

  const setActive = useMutation({
    mutationFn: async (isActive) => (await api.patch(`/clients/${id}`, { isActive })).data,
    onSuccess: (saved) => {
      refresh(saved);
      setConfirmArchive(false);
      toast.success(t(saved.isActive ? 'clients.restored' : 'clients.archivedToast'));
    },
    onError: (failure) => toast.error(localiseServerMessage(failure.friendlyMessage)),
  });

  const { data: uploads } = useQuery({
    queryKey: ['imports', { clientAccountId: id, limit: 5 }],
    queryFn: async () =>
      (await api.get('/imports', { params: { clientAccountId: id, limit: 5 } })).data,
    enabled: Boolean(id) && can(P.IMPORTS_VIEW),
  });

  if (!isNew && error) return <ErrorState error={error} onRetry={refetch} />;
  if (!isNew && isLoading) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-12 d-block" style={{ height: 320 }} />
      </div>
    );
  }

  const update = (uid, patch) =>
    setRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  const move = (index, delta) =>
    setRows((current) => {
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(index + delta, 0, row);
      return next;
    });
  const addRow = () =>
    setRows((current) => [...current, { uid: nextId(), header: '', target: '', required: false }]);
  const addBasics = () =>
    setRows((current) => [
      ...current,
      ...BASIC_FIELDS.filter((key) => !current.some((row) => row.target === key)).map((key) => ({
        uid: nextId(),
        header: fieldLabel(key),
        target: key,
        required: key === 'fullName',
      })),
    ]);

  const rowProblems = (index) => problems.filter((problem) => problem.index === index);
  const generalProblems = problems.filter((problem) => problem.index === -1);
  const problemText = (problem) => (i18n.language === 'en' ? problem.messageEn : problem.messageAr);

  const name = client ? localisedName(client, i18n.language) : t('clients.newTitle');
  const savedFields = client?.templateFields?.length ?? 0;
  const readOnly = !canManage;

  const downloadTemplate = () =>
    saveFromApi(`/clients/${id}/template`, {
      params: { lang: i18n.language === 'en' ? 'en' : 'ar' },
      fileName: t('clients.templateFileName', { name }),
    }).catch(async (failure) =>
      toast.error(localiseServerMessage(await saveErrorMessage(failure, t))),
    );

  return (
    <>
      <PageHeader
        title={name}
        breadcrumb={
          <Link to="/clients" className="small text-body-secondary text-decoration-none">
            <i
              className={`bi ${i18n.dir() === 'rtl' ? 'bi-arrow-right' : 'bi-arrow-left'} me-1`}
              aria-hidden="true"
            />
            {t('clients.title')}
          </Link>
        }
        subtitle={client && !client.isActive ? t('clients.archived') : undefined}
        actions={
          <>
            {!isNew && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={downloadTemplate}
                disabled={savedFields === 0}
              >
                <i className="bi bi-download me-1" aria-hidden="true" />
                {t('clients.downloadTemplate')}
              </button>
            )}
            {!isNew && can(P.IMPORTS_CREATE) && client?.isActive && (
              <Link
                to={`/clients/${id}/import`}
                className={`btn btn-sm btn-outline-primary ${savedFields === 0 ? 'disabled' : ''}`}
              >
                <i className="bi bi-file-earmark-arrow-up me-1" aria-hidden="true" />
                {t('clients.upload')}
              </Link>
            )}
            {canManage && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                {save.isPending ? (
                  <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
                ) : (
                  <i className="bi bi-check2 me-1" aria-hidden="true" />
                )}
                {t('common.save')}
              </button>
            )}
          </>
        }
      />

      <div className="row g-3">
        <div className="col-12 col-xl-4">
          <Panel title={t('clients.details')} className="mb-3">
            <div className="d-flex align-items-center gap-3 mb-3">
              {pendingLogoUrl ? (
                <span className="client-logo has-image" style={{ width: 84, height: 84 }}>
                  <img src={pendingLogoUrl} alt="" />
                </span>
              ) : (
                <ClientLogo client={client ?? { nameEn: form.nameEn, nameAr: form.nameAr }} size={84} />
              )}
              {canManage && (
                <div className="d-flex flex-column gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => logoInput.current?.click()}
                    disabled={uploadLogo.isPending}
                  >
                    {uploadLogo.isPending ? (
                      <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
                    ) : (
                      <i className="bi bi-image me-1" aria-hidden="true" />
                    )}
                    {client?.logoVersion || pendingLogo ? t('clients.changeLogo') : t('clients.addLogo')}
                  </button>
                  {(client?.logoVersion || pendingLogo) && (
                    <button
                      type="button"
                      className="btn btn-sm btn-link text-danger p-0 text-start"
                      onClick={() => (pendingLogo ? setPendingLogo(null) : removeLogo.mutate())}
                    >
                      {t('clients.removeLogo')}
                    </button>
                  )}
                  <span className="text-body-secondary" style={{ fontSize: '.72rem' }}>
                    {t('clients.logoHint')}
                  </span>
                </div>
              )}
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="d-none"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  if (isNew) setPendingLogo(file);
                  else uploadLogo.mutate({ clientId: id, file });
                }}
              />
            </div>

            <div className="mb-2">
              <label className="form-label small fw-semibold" htmlFor="client-name-ar">
                {t('clients.nameAr')} <span className="text-danger">*</span>
              </label>
              <input
                id="client-name-ar"
                className="form-control"
                dir="rtl"
                value={form.nameAr}
                disabled={readOnly}
                onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
                placeholder="بنك مصر"
              />
            </div>
            <div className="mb-2">
              <label className="form-label small fw-semibold" htmlFor="client-name-en">
                {t('clients.nameEn')} <span className="text-danger">*</span>
              </label>
              <input
                id="client-name-en"
                className="form-control"
                dir="ltr"
                value={form.nameEn}
                disabled={readOnly}
                onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
                placeholder="Banque Misr"
              />
            </div>
            <div className="row g-2 mb-2">
              <div className="col-6">
                <label className="form-label small fw-semibold" htmlFor="client-phone">
                  {t('clients.contactPhone')}
                </label>
                <input
                  id="client-phone"
                  className="form-control form-control-sm"
                  dir="ltr"
                  value={form.contactPhone}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
                />
              </div>
              <div className="col-6">
                <label className="form-label small fw-semibold" htmlFor="client-email">
                  {t('clients.contactEmail')}
                </label>
                <input
                  id="client-email"
                  type="email"
                  className="form-control form-control-sm"
                  dir="ltr"
                  value={form.contactEmail}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
                />
              </div>
            </div>
          </Panel>

          <Panel title={t('clients.allowedTitle')} className="mb-3">
            <p className="small text-body-secondary">{t('clients.allowedHint')}</p>
            <div className="mb-3">
              <div className="form-label small fw-semibold" id="client-products-label">
                {t('clients.allowedProducts')}{' '}
                <span className="text-body-tertiary fw-normal">({t('common.optional')})</span>
              </div>
              <MultiSelectAll
                id="client-products"
                options={products ?? []}
                value={form.productIds}
                disabled={readOnly}
                onChange={(productIds) => setForm({ ...form, productIds })}
              />
            </div>
            <div>
              <div className="form-label small fw-semibold" id="client-types-label">
                {t('clients.allowedTypes')}{' '}
                <span className="text-body-tertiary fw-normal">({t('common.optional')})</span>
              </div>
              <MultiSelectAll
                id="client-types"
                options={types ?? []}
                value={form.investigationTypeIds}
                disabled={readOnly}
                onChange={(investigationTypeIds) => setForm({ ...form, investigationTypeIds })}
              />
            </div>
          </Panel>

          {!isNew && canManage && (
            <div className="text-center">
              {client?.isActive ? (
                <button
                  type="button"
                  className="btn btn-sm btn-link text-danger"
                  onClick={() => setConfirmArchive(true)}
                >
                  <i className="bi bi-archive me-1" aria-hidden="true" />
                  {t('clients.archive')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setActive.mutate(true)}
                >
                  <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
                  {t('clients.restore')}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="col-12 col-xl-8">
          <Panel
            title={
              <>
                {t('clients.templateFields')} <span className="text-danger">*</span>
              </>
            }
            className="mb-3"
            actions={
              canManage && (
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={addBasics}>
                  <i className="bi bi-magic me-1" aria-hidden="true" />
                  {t('clients.addBasics')}
                </button>
              )
            }
          >
            <p className="small text-body-secondary">{t('clients.templateHint')}</p>

            {generalProblems.map((problem) => (
              <div key={problem.messageEn} className="alert alert-danger py-2 px-3 small">
                {problemText(problem)}
              </div>
            ))}

            {rows.length === 0 ? (
              <div className="text-center text-body-secondary small py-4 border rounded-3 border-dashed">
                <i className="bi bi-layout-three-columns d-block fs-3 mb-2" aria-hidden="true" />
                {t('clients.noFieldsYet')}
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle template-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th>{t('clients.columnName')}</th>
                      <th>{t('clients.linkedTo')}</th>
                      <th style={{ width: 80 }} className="text-center">
                        {t('clients.required')}
                      </th>
                      {canManage && <th style={{ width: 110 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const mine = rowProblems(index);
                      const catalogue = (systemFields ?? []).find((field) => field.key === row.target);
                      return (
                        <tr key={row.uid} className={mine.length ? 'table-danger-subtle' : ''}>
                          <td className="text-body-secondary">{index + 1}</td>
                          <td>
                            <input
                              className={`form-control form-control-sm ${mine.length ? 'is-invalid' : ''}`}
                              value={row.header}
                              dir="auto"
                              disabled={readOnly}
                              placeholder={t('clients.columnPlaceholder')}
                              onChange={(event) => update(row.uid, { header: event.target.value })}
                            />
                            {mine.map((problem) => (
                              <div key={problem.messageEn} className="invalid-feedback d-block">
                                {problemText(problem)}
                              </div>
                            ))}
                          </td>
                          <td>
                            <select
                              className="form-select form-select-sm"
                              value={row.target ?? ''}
                              disabled={readOnly}
                              onChange={(event) => {
                                const target = event.target.value;
                                update(row.uid, {
                                  target,
                                  // A system field's own label is a fine column name.
                                  header: row.header || (target ? fieldLabel(target) : ''),
                                });
                              }}
                            >
                              <option value="">{t('clients.customField')}</option>
                              {(systemFields ?? []).map((field) => (
                                <option
                                  key={field.key}
                                  value={field.key}
                                  disabled={usedTargets.has(field.key) && row.target !== field.key}
                                >
                                  {i18n.language === 'en' ? field.labelEn : field.labelAr}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="text-center">
                            {row.target ? (
                              catalogue?.required ? (
                                <i
                                  className="bi bi-check-lg text-success"
                                  title={t('clients.requiredBySystem')}
                                />
                              ) : (
                                <span className="text-body-tertiary">—</span>
                              )
                            ) : (
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={Boolean(row.required)}
                                disabled={readOnly}
                                aria-label={t('clients.required')}
                                onChange={(event) => update(row.uid, { required: event.target.checked })}
                              />
                            )}
                          </td>
                          {canManage && (
                            <td className="text-nowrap text-end">
                              <button
                                type="button"
                                className="btn btn-sm btn-icon"
                                onClick={() => move(index, -1)}
                                disabled={index === 0}
                                aria-label={t('clients.moveUp')}
                              >
                                <i className="bi bi-arrow-up" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-icon"
                                onClick={() => move(index, 1)}
                                disabled={index === rows.length - 1}
                                aria-label={t('clients.moveDown')}
                              >
                                <i className="bi bi-arrow-down" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-icon text-danger"
                                onClick={() =>
                                  setRows((current) => current.filter((item) => item.uid !== row.uid))
                                }
                                aria-label={t('common.delete')}
                              >
                                <i className="bi bi-trash3" aria-hidden="true" />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {canManage && (
              <button type="button" className="btn btn-sm btn-success mt-2" onClick={addRow}>
                <i className="bi bi-plus-circle me-1" aria-hidden="true" />
                {t('clients.addField')}
              </button>
            )}
          </Panel>

          {!isNew && can(P.IMPORTS_VIEW) && (
            <Panel
              title={t('clients.recentUploads')}
              actions={
                <Link to={`/investigations?clientAccountId=${id}`} className="btn btn-sm btn-link">
                  {t('clients.viewCases', { count: client?.investigationCount ?? 0 })}
                </Link>
              }
            >
              {(uploads?.data ?? []).length === 0 ? (
                <p className="small text-body-secondary mb-0">{t('clients.noUploads')}</p>
              ) : (
                <ul className="list-unstyled mb-0 client-uploads">
                  {uploads.data.map((batch) => (
                    <li key={batch.id}>
                      <Link to={`/imports/${batch.id}`} className="mono">
                        {batch.reference}
                      </Link>
                      <span className="truncate text-body-secondary small">{batch.fileName}</span>
                      <StateBadge value={batch.status} namespace="importStatus" />
                      <span className="small text-body-secondary">
                        {new Date(batch.uploadedAt).toLocaleDateString(
                          i18n.language === 'en' ? 'en-GB' : 'ar-EG',
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => setActive.mutate(false)}
        title={t('clients.archive')}
        message={t('clients.archiveConfirm', { name })}
        confirmLabel={t('clients.archive')}
        busy={setActive.isPending}
      />
    </>
  );
}

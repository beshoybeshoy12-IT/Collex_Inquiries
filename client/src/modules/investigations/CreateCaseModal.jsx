import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { localisedName } from '../../i18n';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useClients } from '../../hooks/useClients';
import {
  useCities,
  useGovernorates,
  useInvestigationTypes,
  useProducts,
} from '../../hooks/useCatalog';

/**
 * Manual case entry.
 *
 * Two things this screen does that a naive form would not:
 *
 *  - THE INVESTIGATION TYPE LIST IS FILTERED BY THE CHOSEN PRODUCT. Only the
 *    pairings the product actually enables are offered, because the server
 *    refuses the rest — and offering a choice that is going to be rejected is
 *    just a slower way of saying no.
 *
 *  - DUPLICATES ARE CHECKED WHILE THE USER TYPES, not on submit. A coordinator
 *    who has already keyed in a full customer and then gets a 409 has to decide
 *    what to do with work they have already done. Showing the match next to the
 *    national id field lets them switch to the existing customer in one click.
 */
export default function CreateCaseModal({ open, onClose, onCreated }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState('new'); // 'new' | 'existing'
  const [form, setForm] = useState(emptyForm());
  const [customerSearch, setCustomerSearch] = useState('');

  const { data: products } = useProducts();
  const { data: clients } = useClients();
  const { data: allTypes } = useInvestigationTypes();
  const { data: governorates } = useGovernorates();
  const { data: cities } = useCities(form.governorateId);

  useEffect(() => {
    if (open) {
      setForm(emptyForm());
      setMode('new');
      setCustomerSearch('');
    }
  }, [open]);

  // The chosen client's products and types; an empty list means all.
  const chosenClient = (clients ?? []).find((client) => client.id === form.clientAccountId);
  const clientProducts = useMemo(
    () =>
      chosenClient?.productIds?.length
        ? (products ?? []).filter((product) => chosenClient.productIds.includes(product.id))
        : products ?? [],
    [chosenClient, products],
  );

  // Only the types this product enables (and the client has). The pairing rows
  // are included on the product, so this needs no extra request.
  const availableTypes = useMemo(() => {
    const clientTypes = chosenClient?.investigationTypeIds;
    const forClient = (list) =>
      clientTypes?.length ? list.filter((type) => clientTypes.includes(type.id)) : list;
    if (!form.productId || !products || !allTypes) return forClient(allTypes ?? []);

    const product = products.find((candidate) => candidate.id === form.productId);
    const enabled = new Set(
      (product?.investigationTypes ?? [])
        .filter((pairing) => pairing.isActive)
        .map((pairing) => pairing.investigationTypeId),
    );

    return forClient(allTypes.filter((type) => enabled.has(type.id)));
  }, [form.productId, products, allTypes, chosenClient]);

  // Clear a type that the newly-chosen product does not allow, rather than
  // submitting it and getting a 400.
  useEffect(() => {
    if (
      form.investigationTypeId &&
      availableTypes.length > 0 &&
      !availableTypes.some((type) => type.id === form.investigationTypeId)
    ) {
      setForm((current) => ({ ...current, investigationTypeId: '' }));
    }
  }, [availableTypes, form.investigationTypeId]);

  // Duplicate check, debounced, on the identifying fields only.
  const { data: duplicates } = useQuery({
    queryKey: ['duplicate-check', form.nationalId, form.mobile],
    queryFn: async () =>
      (
        await api.post('/customers/check-duplicates', {
          nationalId: form.nationalId || undefined,
          mobile: form.mobile || undefined,
        })
      ).data,
    enabled:
      mode === 'new' &&
      Boolean((form.nationalId?.length ?? 0) >= 10 || (form.mobile?.length ?? 0) >= 9),
    staleTime: 10_000,
  });

  // Customer lookup for the "existing customer" path.
  const { data: customerMatches } = useQuery({
    queryKey: ['customer-search', customerSearch],
    queryFn: async () =>
      (await api.get('/customers', { params: { search: customerSearch, limit: 8 } })).data
        .data,
    enabled: mode === 'existing' && customerSearch.trim().length >= 3,
  });

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        clientAccountId: form.clientAccountId || undefined,
        productId: form.productId,
        investigationTypeId: form.investigationTypeId,
        priority: form.priority || undefined,
        applicationNumber: form.applicationNumber || undefined,
        addressLine: form.addressLine || undefined,
        governorateId: form.governorateId || undefined,
        cityId: form.cityId || undefined,
        notes: form.notes || undefined,
      };

      if (mode === 'existing') {
        payload.customerId = form.customerId;
      } else {
        payload.customer = {
          fullName: form.fullName,
          nationalId: form.nationalId || undefined,
          mobile: form.mobile || undefined,
          residenceAddress: form.addressLine || undefined,
          workplaceName: form.workplaceName || undefined,
          governorateId: form.governorateId || undefined,
          cityId: form.cityId || undefined,
        };
      }

      return (await api.post('/investigations', payload)).data;
    },
    onSuccess: (created) => {
      toast.success(created.caseNumber);
      queryClient.invalidateQueries({ queryKey: ['investigations'] });
      queryClient.invalidateQueries({ queryKey: ['investigation-counts'] });
      onCreated?.(created);
    },
    onError: (error) => toast.error(localiseServerMessage(error.friendlyMessage)),
  });

  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const valid =
    form.productId &&
    form.investigationTypeId &&
    (mode === 'existing' ? form.customerId : form.fullName.trim().length >= 3);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="modal-lg"
      title={t('cases.newCase')}
      busy={create.isPending}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onClose}
            disabled={create.isPending}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => create.mutate()}
            disabled={!valid || create.isPending}
          >
            {create.isPending && (
              <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
            )}
            {t('common.create')}
          </button>
        </>
      }
    >
      <ul className="nav nav-pills nav-sm mb-3 gap-1">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link py-1 px-3 ${mode === 'new' ? 'active' : ''}`}
            onClick={() => setMode('new')}
          >
            {t('cases.newCustomer')}
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link py-1 px-3 ${mode === 'existing' ? 'active' : ''}`}
            onClick={() => setMode('existing')}
          >
            {t('cases.existingCustomer')}
          </button>
        </li>
      </ul>

      {mode === 'existing' ? (
        <div className="mb-3">
          <label className="form-label small fw-semibold">{t('customers.customer')}</label>
          <input
            type="search"
            className="form-control form-control-sm"
            placeholder={t('customers.searchPlaceholder')}
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
          />

          {customerMatches?.length > 0 && (
            <div className="list-group mt-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {customerMatches.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className={`list-group-item list-group-item-action py-2 ${
                    form.customerId === customer.id ? 'active' : ''
                  }`}
                  onClick={() =>
                    setForm((current) => ({ ...current, customerId: customer.id }))
                  }
                >
                  <div className="fw-medium">{customer.fullName}</div>
                  <div className="small opacity-75 mono">
                    {customer.nationalId ?? '—'} · {customer.mobile ?? '—'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="row g-2 mb-2">
            <div className="col-12 col-md-6">
              <label className="form-label small fw-semibold">
                {t('customers.fullName')} <span className="text-danger">*</span>
              </label>
              <input
                className="form-control form-control-sm"
                value={form.fullName}
                onChange={set('fullName')}
              />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label small fw-semibold">
                {t('customers.nationalId')}
              </label>
              <input
                className="form-control form-control-sm mono"
                dir="ltr"
                value={form.nationalId}
                onChange={set('nationalId')}
              />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label small fw-semibold">{t('customers.mobile')}</label>
              <input
                className="form-control form-control-sm mono"
                dir="ltr"
                value={form.mobile}
                onChange={set('mobile')}
              />
            </div>
          </div>

          {duplicates?.length > 0 && (
            <div className="alert alert-warning py-2 px-3 small">
              <div className="fw-semibold mb-1">
                <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                {t('customers.possibleDuplicates')}
              </div>
              <div className="mb-2">{t('customers.duplicateHint')}</div>
              {duplicates.map((match) => (
                <div
                  key={match.customer.id}
                  className="d-flex justify-content-between align-items-center gap-2 py-1"
                >
                  <span>
                    {match.customer.fullName}
                    <span className="text-body-secondary ms-2 mono">
                      {match.customer.nationalId ?? match.customer.mobile}
                    </span>
                    <span className="badge text-bg-light ms-2">
                      {t(`customers.duplicateRule.${match.rule}`, match.rule)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary py-0"
                    onClick={() => {
                      setMode('existing');
                      setCustomerSearch(match.customer.fullName);
                      setForm((current) => ({
                        ...current,
                        customerId: match.customer.id,
                      }));
                    }}
                  >
                    {t('cases.existingCustomer')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="row g-2 mb-2">
            <div className="col-12 col-md-6">
              <label className="form-label small fw-semibold">
                {t('customers.workplaceName')}
              </label>
              <input
                className="form-control form-control-sm"
                value={form.workplaceName}
                onChange={set('workplaceName')}
              />
            </div>
          </div>
        </>
      )}

      <hr />

      <div className="row g-2">
        {(clients ?? []).length > 0 && (
          <div className="col-12">
            <label className="form-label small fw-semibold">{t('clients.client')}</label>
            <select
              className="form-select form-select-sm"
              value={form.clientAccountId}
              onChange={(event) => {
                const chosen = clients.find((client) => client.id === event.target.value);
                // A pick the client does not have is cleared; a client with a
                // single product or type gets it filled in.
                const fit = (picked, ids) =>
                  !ids?.length ? picked : ids.length === 1 ? ids[0] : ids.includes(picked) ? picked : '';
                setForm((current) => ({
                  ...current,
                  clientAccountId: event.target.value,
                  productId: fit(current.productId, chosen?.productIds),
                  investigationTypeId: fit(current.investigationTypeId, chosen?.investigationTypeIds),
                }));
              }}
            >
              <option value="">—</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {localisedName(client, i18n.language)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">
            {t('cases.product')} <span className="text-danger">*</span>
          </label>
          <select
            className="form-select form-select-sm"
            value={form.productId}
            onChange={set('productId')}
          >
            <option value="">—</option>
            {clientProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {localisedName(product, i18n.language)}
              </option>
            ))}
          </select>
        </div>

        <div className="col-12 col-md-6">
          <label className="form-label small fw-semibold">
            {t('cases.investigationType')} <span className="text-danger">*</span>
          </label>
          <select
            className="form-select form-select-sm"
            value={form.investigationTypeId}
            onChange={set('investigationTypeId')}
            disabled={!form.productId}
          >
            <option value="">—</option>
            {availableTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {localisedName(type, i18n.language)}
              </option>
            ))}
          </select>
          {form.productId && availableTypes.length === 0 && (
            <div className="form-text text-warning small">
              {t('catalog.enabledTypesHint')}
            </div>
          )}
        </div>

        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold">{t('cases.priority')}</label>
          <select
            className="form-select form-select-sm"
            value={form.priority}
            onChange={set('priority')}
          >
            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((priority) => (
              <option key={priority} value={priority}>
                {t(`priority.${priority}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold">
            {t('cases.applicationNumber')}
          </label>
          <input
            className="form-control form-control-sm mono"
            dir="ltr"
            value={form.applicationNumber}
            onChange={set('applicationNumber')}
          />
        </div>

        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold">{t('cases.governorate')}</label>
          <select
            className="form-select form-select-sm"
            value={form.governorateId}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                governorateId: event.target.value,
                cityId: '',
              }))
            }
          >
            <option value="">—</option>
            {(governorates ?? []).map((governorate) => (
              <option key={governorate.id} value={governorate.id}>
                {localisedName(governorate, i18n.language)}
              </option>
            ))}
          </select>
        </div>

        <div className="col-6 col-md-3">
          <label className="form-label small fw-semibold">{t('cases.city')}</label>
          <select
            className="form-select form-select-sm"
            value={form.cityId}
            onChange={set('cityId')}
            disabled={!form.governorateId}
          >
            <option value="">—</option>
            {(cities ?? []).map((city) => (
              <option key={city.id} value={city.id}>
                {localisedName(city, i18n.language)}
              </option>
            ))}
          </select>
        </div>

        <div className="col-12">
          <label className="form-label small fw-semibold">{t('cases.address')}</label>
          <input
            className="form-control form-control-sm"
            value={form.addressLine}
            onChange={set('addressLine')}
          />
        </div>

        <div className="col-12">
          <label className="form-label small fw-semibold">{t('common.notes')}</label>
          <textarea
            className="form-control form-control-sm"
            rows={2}
            value={form.notes}
            onChange={set('notes')}
          />
        </div>
      </div>
    </Modal>
  );
}

function emptyForm() {
  return {
    customerId: '',
    fullName: '',
    nationalId: '',
    mobile: '',
    workplaceName: '',
    clientAccountId: '',
    productId: '',
    investigationTypeId: '',
    priority: 'NORMAL',
    applicationNumber: '',
    governorateId: '',
    cityId: '',
    addressLine: '',
    notes: '',
  };
}

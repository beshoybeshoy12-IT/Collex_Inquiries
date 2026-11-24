import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { useToast } from '../../components/Toast';
import Modal from '../../components/Modal';
import { localisedName } from '../../i18n';

const PRIORITIES = ['NORMAL', 'IMPORTANT', 'URGENT'];

/** "2026-11-30T15:00" for a datetime-local input, in local time. */
function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Write or edit an announcement. The audience picker lists the company's
 * roles; when the publisher cannot read roles it is simply not offered and the
 * announcement goes to everyone.
 */
export default function AnnouncementComposer({ announcement, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState(() => ({
    title: announcement?.title ?? '',
    body: announcement?.body ?? '',
    priority: announcement?.priority ?? 'NORMAL',
    pinned: announcement?.pinned ?? false,
    audienceRoleIds: announcement?.audienceRoleIds ?? [],
    expiresAt: toLocalInput(announcement?.expiresAt),
  }));
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/roles')).data,
    retry: false,
  });
  const roleList = Array.isArray(roles.data) ? roles.data : (roles.data?.items ?? []);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        body: form.body,
        priority: form.priority,
        pinned: form.pinned,
        audienceRoleIds: form.audienceRoleIds,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      };
      return announcement
        ? (await api.patch(`/announcements/${announcement.id}`, payload)).data
        : (await api.post('/announcements', payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast.success(t(announcement ? 'common.saved' : 'home.published'));
      onClose();
    },
    onError: (error) =>
      toast.error(localiseServerMessage(error.friendlyMessage ?? t('errors.unknown'))),
  });

  const toggleRole = (id) =>
    set({
      audienceRoleIds: form.audienceRoleIds.includes(id)
        ? form.audienceRoleIds.filter((roleId) => roleId !== id)
        : [...form.audienceRoleIds, id],
    });

  const valid = form.title.trim() && form.body.trim();

  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      size="modal-lg"
      title={t(announcement ? 'home.editAnnouncement' : 'home.newAnnouncement')}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending && (
              <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
            )}
            {t(announcement ? 'common.save' : 'home.publish')}
          </button>
        </>
      }
    >
      <div className="mb-3">
        <label className="form-label" htmlFor="ann-title">
          {t('home.fields.title')}
        </label>
        <input
          id="ann-title"
          className="form-control"
          maxLength={160}
          value={form.title}
          onChange={(event) => set({ title: event.target.value })}
        />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="ann-body">
          {t('home.fields.body')}
        </label>
        <textarea
          id="ann-body"
          className="form-control"
          rows={5}
          maxLength={4000}
          value={form.body}
          onChange={(event) => set({ body: event.target.value })}
        />
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-md-7">
          <div className="form-label">{t('home.fields.priority')}</div>
          <div className="segmented" role="group">
            {PRIORITIES.map((priority) => (
              <button
                key={priority}
                type="button"
                className={form.priority === priority ? 'active' : ''}
                onClick={() => set({ priority })}
              >
                {t(`home.priority.${priority}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="col-12 col-md-5">
          <label className="form-label" htmlFor="ann-expires">
            {t('home.fields.expiresAt')}
          </label>
          <input
            id="ann-expires"
            type="datetime-local"
            className="form-control"
            value={form.expiresAt}
            onChange={(event) => set({ expiresAt: event.target.value })}
          />
        </div>
      </div>

      <div className="form-check form-switch mb-3">
        <input
          id="ann-pinned"
          type="checkbox"
          className="form-check-input"
          checked={form.pinned}
          onChange={(event) => set({ pinned: event.target.checked })}
        />
        <label className="form-check-label" htmlFor="ann-pinned">
          {t('home.fields.pinned')}
        </label>
      </div>

      {roleList.length > 0 && (
        <fieldset>
          <legend className="form-label fs-6">{t('home.fields.audience')}</legend>
          <div className="d-flex flex-wrap gap-2">
            <button
              type="button"
              className={`btn btn-sm ${
                form.audienceRoleIds.length === 0 ? 'btn-primary' : 'btn-outline-secondary'
              }`}
              onClick={() => set({ audienceRoleIds: [] })}
            >
              {t('home.everyone')}
            </button>
            {roleList.map((role) => (
              <button
                key={role.id}
                type="button"
                className={`btn btn-sm ${
                  form.audienceRoleIds.includes(role.id) ? 'btn-primary' : 'btn-outline-secondary'
                }`}
                onClick={() => toggleRole(role.id)}
              >
                {localisedName(role)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </Modal>
  );
}

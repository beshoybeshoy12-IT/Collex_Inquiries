import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { useToast } from '../../components/Toast';
import { useRealtime } from '../../hooks/useRealtime';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import { timeAgo } from '../../utils/timeAgo';
import AnnouncementComposer from './AnnouncementComposer';

const FILTERS = ['all', 'unread', 'pinned'];
const PRIORITY_ICON = {
  URGENT: 'exclamation-octagon-fill',
  IMPORTANT: 'exclamation-circle-fill',
  NORMAL: 'megaphone',
};

/**
 * Company announcements: the feed for everyone, and the tools for whoever
 * holds `announcements.manage` (the server says which via `canManage`).
 *
 * Opening an announcement marks it read. The publisher sees "read by 7 / 12"
 * and can open the list of readers.
 */
export default function AnnouncementsPanel() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | announcement
  const [readersOf, setReadersOf] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => (await api.get('/announcements')).data,
    refetchInterval: 5 * 60_000,
  });

  useRealtime('announcement:changed', () => {
    queryClient.invalidateQueries({ queryKey: ['announcements'] });
  });

  const markRead = useMutation({
    mutationFn: async (id) => (await api.post(`/announcements/${id}/read`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['announcements'] }),
  });

  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/announcements/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast.success(t('home.announcementDeleted'));
    },
    onError: (error) =>
      toast.error(localiseServerMessage(error.friendlyMessage ?? t('errors.unknown'))),
  });

  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (filter === 'unread') return all.filter((item) => !item.readAt);
    if (filter === 'pinned') return all.filter((item) => item.pinned);
    return all;
  }, [data, filter]);

  const open = (item) => {
    setExpanded((current) => (current === item.id ? null : item.id));
    if (!item.readAt && !markRead.isPending) markRead.mutate(item.id);
  };

  return (
    <div className="card h-100">
      <div className="card-header bg-body d-flex flex-wrap align-items-center justify-content-between gap-2 py-2">
        <span className="fw-semibold d-inline-flex align-items-center gap-2">
          <span className="panel-icon" aria-hidden="true">
            <i className="bi bi-megaphone" />
          </span>
          {t('home.announcements')}
          {data?.unread > 0 && (
            <span className="badge rounded-pill text-bg-primary">{data.unread}</span>
          )}
        </span>

        <div className="d-flex align-items-center gap-2">
          <div className="segmented" role="group" aria-label={t('home.filter')}>
            {FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'active' : ''}
                onClick={() => setFilter(key)}
              >
                {t(`home.filters.${key}`)}
              </button>
            ))}
          </div>
          {data?.canManage && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setEditing('new')}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              {t('home.newAnnouncement')}
            </button>
          )}
        </div>
      </div>

      <div className="card-body p-0 announcements-body">
        {isLoading ? (
          <div className="p-3 placeholder-glow">
            {[0, 1, 2].map((n) => (
              <span key={n} className="placeholder col-12 rounded mb-3" style={{ height: 64 }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="megaphone"
            title={t(filter === 'all' ? 'home.noAnnouncements' : 'home.noMatching')}
          />
        ) : (
          <ul className="list-unstyled mb-0">
            {items.map((item) => (
              <li
                key={item.id}
                className={`announcement announcement-${item.priority.toLowerCase()} ${
                  item.readAt ? '' : 'is-unread'
                } ${item.expired ? 'is-expired' : ''}`}
              >
                <button
                  type="button"
                  className="announcement__main"
                  onClick={() => open(item)}
                  aria-expanded={expanded === item.id}
                >
                  <span className="announcement__icon" aria-hidden="true">
                    <i className={`bi bi-${PRIORITY_ICON[item.priority]}`} />
                  </span>
                  <span className="announcement__text">
                    <span className="announcement__title">
                      {item.pinned && (
                        <i
                          className="bi bi-pin-angle-fill text-primary me-1"
                          aria-label={t('home.pinned')}
                        />
                      )}
                      {item.title}
                      {item.priority !== 'NORMAL' && (
                        <span className={`announcement__tag tag-${item.priority.toLowerCase()}`}>
                          {t(`home.priority.${item.priority}`)}
                        </span>
                      )}
                    </span>
                    <span
                      className={`announcement__body ${expanded === item.id ? 'is-open' : ''}`}
                    >
                      {item.body}
                    </span>
                    <span className="announcement__meta">
                      {item.author?.fullName ?? t('home.system')} ·{' '}
                      {timeAgo(item.createdAt, i18n.language)}
                      {item.expiresAt && (
                        <>
                          {' · '}
                          <i className="bi bi-hourglass-split" aria-hidden="true" />{' '}
                          {item.expired
                            ? t('home.expired')
                            : t('home.expires', {
                                date: new Date(item.expiresAt).toLocaleDateString(
                                  i18n.language === 'en' ? 'en-GB' : 'ar-EG',
                                ),
                              })}
                        </>
                      )}
                    </span>
                  </span>
                  {!item.readAt && <span className="announcement__dot" aria-label={t('home.unread')} />}
                </button>

                {data?.canManage && (
                  <div className="announcement__tools">
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 text-decoration-none"
                      onClick={() => setReadersOf(item)}
                    >
                      <i className="bi bi-eye me-1" aria-hidden="true" />
                      {t('home.readBy', { read: item.readCount, total: item.audienceCount })}
                    </button>
                    <span className="ms-auto d-inline-flex gap-1">
                      <button
                        type="button"
                        className="btn btn-sm btn-icon"
                        title={t('common.edit')}
                        aria-label={t('common.edit')}
                        onClick={() => setEditing(item)}
                      >
                        <i className="bi bi-pencil" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-icon text-danger"
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(t('home.confirmDelete'))) remove.mutate(item.id);
                        }}
                      >
                        <i className="bi bi-trash" aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <AnnouncementComposer
          announcement={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ReadersModal item={readersOf} onClose={() => setReadersOf(null)} />
    </div>
  );
}

function ReadersModal({ item, onClose }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['announcement-readers', item?.id],
    enabled: Boolean(item),
    queryFn: async () => (await api.get(`/announcements/${item.id}/readers`)).data,
  });

  return (
    <Modal open={Boolean(item)} onClose={onClose} title={t('home.readers')}>
      {isLoading ? (
        <div className="text-center py-3">
          <span className="spinner-border spinner-border-sm" aria-hidden="true" />
        </div>
      ) : (data ?? []).length === 0 ? (
        <p className="text-body-secondary small mb-0">{t('home.noReaders')}</p>
      ) : (
        <ul className="list-group list-group-flush">
          {data.map((read) => (
            <li
              key={read.user.id}
              className="list-group-item d-flex justify-content-between px-0"
            >
              <span>{read.user.fullName}</span>
              <span className="small text-body-tertiary">
                {timeAgo(read.readAt, i18n.language)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Pagination from '../../components/Pagination';
import { NotificationBody } from './NotificationBell';

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['notifications', page, unreadOnly],
    queryFn: async () =>
      (
        await api.get('/notifications', {
          params: { page, limit: 25, unreadOnly: unreadOnly || undefined },
        })
      ).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
  };

  const markRead = useMutation({
    mutationFn: async (id) => (await api.patch(`/notifications/${id}/read`)).data,
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: async () => (await api.patch('/notifications/read-all')).data,
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/notifications/${id}`)).data,
    onSuccess: invalidate,
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        subtitle={
          data?.unread ? t('notifications.unread', { count: data.unread }) : undefined
        }
        actions={
          <>
            <div className="form-check form-switch d-flex align-items-center gap-2 mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                role="switch"
                id="unread-only"
                checked={unreadOnly}
                onChange={(event) => {
                  setUnreadOnly(event.target.checked);
                  setPage(1);
                }}
              />
              <label className="form-check-label small" htmlFor="unread-only">
                {t('notifications.unread', { count: data?.unread ?? 0 })}
              </label>
            </div>

            {(data?.unread ?? 0) > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="card-body">
          {isLoading ? (
            <div className="placeholder-glow">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className="placeholder col-12 d-block mb-2"
                  style={{ height: 46 }}
                />
              ))}
            </div>
          ) : !data?.data?.length ? (
            <EmptyState title={t('notifications.noNotifications')} icon="bell" />
          ) : (
            <>
              <ul className="list-group list-group-flush">
                {data.data.map((notification) => (
                  <li
                    key={notification.id}
                    className={`list-group-item d-flex justify-content-between align-items-start gap-2 ${
                      notification.readAt ? '' : 'bg-body-tertiary'
                    }`}
                  >
                    <div className="min-vw-0 flex-grow-1 small">
                      <NotificationBody
                        notification={notification}
                        language={i18n.language}
                      />
                    </div>

                    <div className="btn-group btn-group-sm flex-shrink-0">
                      {!notification.readAt && (
                        <button
                          type="button"
                          className="btn btn-outline-secondary py-0"
                          onClick={() => markRead.mutate(notification.id)}
                          title={t('notifications.markRead')}
                        >
                          <i className="bi bi-check2" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-outline-danger py-0"
                        onClick={() => remove.mutate(notification.id)}
                        title={t('common.delete')}
                      >
                        <i className="bi bi-trash" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {data.meta && <Pagination meta={data.meta} onPageChange={setPage} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

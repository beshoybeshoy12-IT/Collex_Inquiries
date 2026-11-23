import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { useRealtime } from '../../hooks/useRealtime';

/**
 * The notification bell.
 *
 * THE COUNT COMES FROM A SOCKET EVENT WHEN THERE IS ONE, and from a slow poll
 * otherwise. A socket that has dropped — or a deployment with no sticky
 * sessions behind a load balancer — must not leave the bell permanently stale,
 * so the poll is the floor rather than the mechanism. Sixty seconds is well
 * inside what anybody notices and is cheap enough at any realistic user count.
 *
 * The panel fetches the list only when opened. Fetching it alongside the count
 * would mean every user pulling ten notification bodies once a minute to render
 * a number.
 */
export default function NotificationBell() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: async () => (await api.get('/notifications/unread-count')).data,
    refetchInterval: 60_000,
  });

  const { data: list, isLoading } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: async () =>
      (await api.get('/notifications', { params: { limit: 10 } })).data,
    enabled: open,
  });

  // A new notification pushes the count up immediately rather than waiting for
  // the next poll.
  useRealtime('notification:new', () => {
    queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });

  const markAllRead = useMutation({
    mutationFn: async () => (await api.patch('/notifications/read-all')).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const count = unread?.unread ?? 0;

  return (
    <div className="position-relative" ref={containerRef}>
      <button
        type="button"
        className="header-icon position-relative"
        onClick={() => setOpen((current) => !current)}
        aria-label={t('notifications.title')}
        aria-expanded={open}
      >
        <i className="bi bi-bell" aria-hidden="true" />
        {count > 0 && (
          <span className="badge rounded-pill bg-danger text-white">
            {count > 99 ? '99+' : count}
            <span className="visually-hidden">{t('notifications.unread', { count })}</span>
          </span>
        )}
      </button>

      {open && (
        <div
          className="card shadow position-absolute mt-1"
          style={{
            // Logical inset so the panel opens inward in both directions rather
            // than off the edge of the viewport in RTL.
            insetInlineEnd: 0,
            width: 'min(360px, 90vw)',
            zIndex: 1050,
          }}
        >
          <div className="card-header py-2 d-flex justify-content-between align-items-center">
            <span className="fw-semibold small">{t('notifications.title')}</span>
            {count > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-link p-0 text-decoration-none small"
                onClick={() => markAllRead.mutate()}
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {isLoading ? (
              <div className="p-3 placeholder-glow">
                {[1, 2, 3].map((n) => (
                  <span key={n} className="placeholder col-12 d-block mb-2" style={{ height: 32 }} />
                ))}
              </div>
            ) : !list?.data?.length ? (
              <p className="text-body-secondary small text-center py-4 mb-0">
                {t('notifications.noNotifications')}
              </p>
            ) : (
              <ul className="list-group list-group-flush">
                {list.data.map((notification) => (
                  <li
                    key={notification.id}
                    className={`list-group-item small ${
                      notification.readAt ? '' : 'bg-body-tertiary'
                    }`}
                  >
                    <NotificationBody notification={notification} language={i18n.language} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card-footer py-2 text-center">
            <Link
              to="/notifications"
              className="small text-decoration-none"
              onClick={() => setOpen(false)}
            >
              {t('notifications.viewAll')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationBody({ notification, language }) {
  const title = language === 'ar' ? notification.titleAr : notification.titleEn;
  const body = language === 'ar' ? notification.bodyAr : notification.bodyEn;

  const content = (
    <>
      <div className="d-flex justify-content-between align-items-baseline gap-2">
        <span className="fw-medium">{title}</span>
        {notification.priority === 'URGENT' && (
          <span className="badge text-bg-danger">!</span>
        )}
      </div>
      <div className="text-body-secondary">{body}</div>
      <div className="text-body-tertiary" style={{ fontSize: '.72rem' }}>
        {new Date(notification.createdAt).toLocaleString(language)}
      </div>
    </>
  );

  return notification.link ? (
    <Link to={notification.link} className="text-decoration-none text-body d-block">
      {content}
    </Link>
  ) : (
    content
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { localiseServerMessage } from '../../services/api';
import { useToast } from '../../components/Toast';
import { clockDuration, timeOfDay } from '../../utils/duration';

/**
 * Check-in / check-out, with today's worked and idle time.
 *
 * THE CLOCK TICKS LOCALLY, THE NUMBERS COME FROM THE SERVER. The server's
 * totals are the truth (it applies the idle rule); between refetches the
 * worked time is advanced by the seconds elapsed since the response, unless
 * the session is idle right now. A minute later the refetch corrects any
 * drift — so a wrong clock on the PC cannot inflate anybody's hours.
 */
export default function AttendanceCard() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const language = i18n.language;

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['attendance-today'],
    queryFn: async () => (await api.get('/attendance/me/today')).data,
    refetchInterval: 60_000,
  });

  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const action = useMutation({
    mutationFn: async (kind) => (await api.post(`/attendance/me/${kind}`)).data,
    onSuccess: (fresh, kind) => {
      queryClient.setQueryData(['attendance-today'], fresh);
      queryClient.invalidateQueries({ queryKey: ['attendance-team'] });
      toast.success(t(kind === 'check-in' ? 'home.checkedIn' : 'home.checkedOut'));
    },
    onError: (error) =>
      toast.error(localiseServerMessage(error.friendlyMessage ?? t('errors.unknown'))),
  });

  const open = data?.open ?? null;
  // Seconds since the server answered, credited to worked or idle time
  // according to the state the server reported.
  const elapsed = open ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000)) : 0;
  const total = (data?.totals.totalSeconds ?? 0) + elapsed;
  const worked = (data?.totals.workedSeconds ?? 0) + (open && !open.idleNow ? elapsed : 0);
  const idle = (data?.totals.idleSeconds ?? 0) + (open?.idleNow ? elapsed : 0);

  const state = open ? (open.idleNow ? 'idle' : 'in') : data?.sessions.length ? 'out' : 'none';

  return (
    <div className={`card h-100 attendance-card attendance-${state}`}>
      <div className="card-body d-flex flex-column">
        <div className="d-flex align-items-center justify-content-between mb-3">
          <span className="fw-semibold d-inline-flex align-items-center gap-2">
            <span className="panel-icon" aria-hidden="true">
              <i className="bi bi-fingerprint" />
            </span>
            {t('home.attendance')}
          </span>
          <span className={`attendance-state attendance-state-${state}`}>
            <span className="attendance-dot" aria-hidden="true" />
            {t(`home.state.${state}`)}
          </span>
        </div>

        {isLoading ? (
          <div className="placeholder-glow flex-grow-1">
            <span className="placeholder col-12 rounded" style={{ height: 180 }} />
          </div>
        ) : (
          <>
            <div className="text-center my-2">
              <div className="attendance-clock" aria-live="off">
                {clockDuration(total)}
              </div>
              <div className="small text-body-secondary">{t('home.totalToday')}</div>
            </div>

            <button
              type="button"
              className={`btn btn-lg w-100 my-3 ${open ? 'btn-danger' : 'btn-primary'}`}
              disabled={action.isPending}
              onClick={() => action.mutate(open ? 'check-out' : 'check-in')}
            >
              {action.isPending ? (
                <span className="spinner-border spinner-border-sm" aria-hidden="true" />
              ) : (
                <i
                  className={`bi ${open ? 'bi-box-arrow-right' : 'bi-box-arrow-in-left'} me-2`}
                  aria-hidden="true"
                />
              )}
              {t(open ? 'home.checkOut' : 'home.checkIn')}
            </button>

            <div className="row g-2">
              <Tile label={t('home.firstIn')} value={timeOfDay(data?.firstCheckInAt, language)} />
              <Tile label={t('home.lastOut')} value={timeOfDay(data?.lastCheckOutAt, language)} />
              <Tile
                label={t('home.worked')}
                value={clockDuration(worked)}
                tone="success"
              />
              <Tile label={t('home.idle')} value={clockDuration(idle)} tone="warning" />
            </div>

            {data?.sessions.length > 1 && (
              <div className="attendance-sessions mt-3">
                {data.sessions.map((session) => (
                  <span key={session.id} className="attendance-session">
                    {timeOfDay(session.checkInAt, language)} –{' '}
                    {session.checkOutAt ? timeOfDay(session.checkOutAt, language) : t('home.now')}
                    {session.autoClosed && (
                      <i
                        className="bi bi-moon-stars ms-1"
                        title={t('home.autoClosed')}
                        aria-label={t('home.autoClosed')}
                      />
                    )}
                  </span>
                ))}
              </div>
            )}

            <p className="small text-body-tertiary mt-auto pt-3 mb-0 d-flex gap-2">
              <i className="bi bi-info-circle" aria-hidden="true" />
              <span>{t('home.idleRule', { minutes: data?.idleMinutes ?? 15 })}</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }) {
  return (
    <div className="col-6">
      <div className={`attendance-tile ${tone ? `attendance-tile-${tone}` : ''}`}>
        <div className="attendance-tile__label">{label}</div>
        <div className="attendance-tile__value">{value}</div>
      </div>
    </div>
  );
}

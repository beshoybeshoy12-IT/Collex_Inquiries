import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';

const EVENT_LABEL = {
  CHECK_IN: 'gps.checkIn',
  CHECK_OUT: 'gps.checkOut',
  PHOTO_CAPTURE: 'gps.photoCapture',
  LOCATION_UPDATE: 'gps.locationUpdate',
  ROUTE_START: 'gps.locationUpdate',
  ROUTE_END: 'gps.locationUpdate',
};

/**
 * GPS evidence for a case.
 *
 * `reportDelaySeconds` — the gap between when the device recorded a fix and
 * when the server received it — is shown rather than hidden. A large positive
 * value means an offline queue flushed later, which is normal; a negative one
 * means the device clock is ahead of the server, which is worth a QC officer
 * noticing.
 *
 * Distance from the address is the number that actually gets acted on, so it
 * is emphasised and turns red at the same 2 km threshold the automatic check
 * uses — the screen and the check must not disagree about what "too far" means.
 */
export default function CaseGps({ investigationId }) {
  const { t, i18n } = useTranslation();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gps', investigationId],
    queryFn: async () =>
      (await api.get(`/gps/investigation/${investigationId}`)).data,
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (isLoading) {
    return (
      <div className="placeholder-glow">
        <span className="placeholder col-12 d-block" style={{ height: 180 }} />
      </div>
    );
  }

  if (!data?.length) {
    return <EmptyState title={t('gps.noEvents')} icon="geo-alt" />;
  }

  return (
    <div className="card">
      <div className="table-responsive">
        <table className="table table-sm align-middle mb-0">
          <thead>
            <tr>
              <th>{t('audit.action')}</th>
              <th>{t('gps.coordinates')}</th>
              <th>{t('gps.accuracy')}</th>
              <th>{t('gps.distanceFromTarget')}</th>
              <th>{t('gps.recordedAt')}</th>
              <th>{t('cases.investigator')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((event) => (
              <tr key={event.id}>
                <td>
                  <span className="badge text-bg-light">
                    {t(EVENT_LABEL[event.eventType] ?? 'gps.locationUpdate')}
                  </span>
                </td>
                <td className="mono">
                  <a
                    href={`https://www.google.com/maps?q=${event.lat},${event.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-decoration-none"
                  >
                    {event.lat.toFixed(6)}, {event.lng.toFixed(6)}
                  </a>
                </td>
                <td className="mono">
                  {event.accuracyM != null ? `${Math.round(event.accuracyM)} m` : '—'}
                </td>
                <td>
                  {event.distanceFromTargetM == null ? (
                    '—'
                  ) : (
                    <span
                      className={
                        event.distanceFromTargetM > 2000
                          ? 'text-danger fw-semibold'
                          : 'text-success'
                      }
                    >
                      {event.distanceFromTargetM < 1000
                        ? `${event.distanceFromTargetM} m`
                        : `${(event.distanceFromTargetM / 1000).toFixed(1)} km`}
                    </span>
                  )}
                </td>
                <td className="small">
                  {new Date(event.recordedAt).toLocaleString(i18n.language)}
                  {Math.abs(event.reportDelaySeconds ?? 0) > 60 && (
                    <div
                      className="text-body-tertiary"
                      style={{ fontSize: '.72rem' }}
                    >
                      {t('gps.reportedLate', {
                        seconds: event.reportDelaySeconds,
                      })}
                    </div>
                  )}
                </td>
                <td className="small">{event.investigator?.fullName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

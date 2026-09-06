import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import PageHeader, { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { AvailabilityBadge } from '../../components/Badges';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Live investigator positions.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  NO MAP TILE PROVIDER IS WIRED UP, and this does not pretend otherwise. A
 *  real basemap means an account, an API key and a per-request bill with
 *  somebody's coordinates in it — a decision for whoever deploys this, not
 *  something to smuggle in. What is here is honest: positions plotted on a
 *  bounded projection of Egypt so relative distribution is visible, a list
 *  beside it, and a link that opens any pin in a real map.
 *
 *  Swapping in Leaflet or MapLibre is one component — the data this screen
 *  already receives is exactly what a tile-based map would consume.
 *
 *  STALENESS IS SHOWN, NOT HIDDEN. A pin from four hours ago is faded and
 *  labelled. A map that presents an old fix as current is worse than no map:
 *  a coordinator will route work on it.
 */

// A bounding box around Egypt, used for the simple equirectangular projection.
const BOUNDS = { minLat: 22.0, maxLat: 31.7, minLng: 24.7, maxLng: 36.9 };

export default function LiveMap() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['live-map'],
    queryFn: async () => (await api.get('/investigators/live-map')).data,
    refetchInterval: 30_000,
  });

  const pins = useMemo(
    () =>
      (data ?? [])
        .filter((row) => row.lat != null && row.lng != null)
        .map((row) => ({
          ...row,
          x: ((row.lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * 100,
          // Inverted: latitude increases northwards, y increases downwards.
          y: ((BOUNDS.maxLat - row.lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * 100,
        }))
        .filter((row) => row.x >= 0 && row.x <= 100 && row.y >= 0 && row.y <= 100),
    [data],
  );

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title={t('investigators.liveMap')}
        subtitle={`${pins.length} / ${data?.length ?? 0}`}
        actions={
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => refetch()}
          >
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
            {t('common.retry')}
          </button>
        }
      />

      <div className="row g-3">
        <div className="col-12 col-lg-8">
          <Panel bodyClassName="p-2">
            {isLoading ? (
              <div className="placeholder-glow">
                <span className="placeholder w-100 d-block rounded" style={{ height: 520 }} />
              </div>
            ) : pins.length === 0 ? (
              <EmptyState title={t('investigators.noLocation')} icon="geo-alt" />
            ) : (
              <div className="map-canvas">
                {/* A plain graticule, so the plot reads as a projection rather
                    than as a scatter chart with no frame of reference. */}
                <svg
                  className="position-absolute w-100 h-100"
                  style={{ inset: 0, opacity: 0.15 }}
                  aria-hidden="true"
                >
                  {[20, 40, 60, 80].map((percent) => (
                    <g key={percent}>
                      <line
                        x1={`${percent}%`}
                        y1="0"
                        x2={`${percent}%`}
                        y2="100%"
                        stroke="currentColor"
                      />
                      <line
                        x1="0"
                        y1={`${percent}%`}
                        x2="100%"
                        y2={`${percent}%`}
                        stroke="currentColor"
                      />
                    </g>
                  ))}
                </svg>

                {pins.map((pin) => {
                  const stale = (pin.staleMinutes ?? 0) > 60;
                  return (
                    <button
                      key={pin.id}
                      type="button"
                      className="map-pin btn p-0 border-0 bg-transparent"
                      style={{
                        insetInlineStart: `${pin.x}%`,
                        insetBlockStart: `${pin.y}%`,
                        opacity: stale ? 0.45 : 1,
                      }}
                      onClick={() => setSelected(pin)}
                      title={`${pin.fullName} · ${t('investigators.locationAge', {
                        minutes: pin.staleMinutes ?? 0,
                      })}`}
                    >
                      <i
                        className={`bi bi-geo-alt-fill fs-4 text-${toneFor(pin.availability)}`}
                        aria-hidden="true"
                      />
                      <span className="visually-hidden">{pin.fullName}</span>
                    </button>
                  );
                })}

                <div
                  className="position-absolute small text-body-tertiary p-2"
                  style={{ insetBlockEnd: 0, insetInlineStart: 0 }}
                >
                  {t('investigators.liveMap')} — {t('gps.coordinates')}
                </div>
              </div>
            )}
          </Panel>

          {selected && (
            <Panel className="mt-3">
              <div className="d-flex justify-content-between align-items-start gap-2">
                <div>
                  <Link
                    to={`/investigators/${selected.id}`}
                    className="fw-semibold text-decoration-none"
                  >
                    {selected.fullName}
                  </Link>
                  <div className="small text-body-secondary">
                    <span className="mono">{selected.employeeCode}</span> ·{' '}
                    {t('assignment.openCases')}: {selected.openCases}
                  </div>
                  <div className="small text-body-tertiary">
                    {t('investigators.locationAge', {
                      minutes: selected.staleMinutes ?? 0,
                    })}
                  </div>
                </div>
                <a
                  className="btn btn-sm btn-outline-primary"
                  href={`https://www.google.com/maps?q=${selected.lat},${selected.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <i className="bi bi-box-arrow-up-right me-1" aria-hidden="true" />
                  {t('gps.coordinates')}
                </a>
              </div>
            </Panel>
          )}
        </div>

        <div className="col-12 col-lg-4">
          <Panel title={t('investigators.title')} bodyClassName="p-0">
            <ul className="list-group list-group-flush">
              {(data ?? []).map((investigator) => (
                <li
                  key={investigator.id}
                  className={`list-group-item ${
                    selected?.id === investigator.id ? 'bg-body-tertiary' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(investigator)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setSelected(investigator);
                  }}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div className="min-vw-0">
                      <div className="truncate fw-medium">{investigator.fullName}</div>
                      <div className="small text-body-secondary">
                        {t('assignment.openCases')}: {investigator.openCases}
                      </div>
                      {investigator.staleMinutes != null && (
                        <div
                          className={`small ${
                            investigator.staleMinutes > 60
                              ? 'text-warning-emphasis'
                              : 'text-body-tertiary'
                          }`}
                        >
                          {t('investigators.locationAge', {
                            minutes: investigator.staleMinutes,
                          })}
                        </div>
                      )}
                    </div>
                    <AvailabilityBadge availability={investigator.availability} />
                  </div>
                </li>
              ))}

              {(data ?? []).length === 0 && !isLoading && (
                <li className="list-group-item small text-body-secondary">
                  {t('investigators.noLocation')}
                </li>
              )}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

function toneFor(availability) {
  return (
    {
      AVAILABLE: 'success',
      ONLINE: 'info',
      BUSY: 'warning',
      ON_VISIT: 'primary',
      EN_ROUTE: 'primary',
      ON_LEAVE: 'dark',
      OFFLINE: 'secondary',
    }[availability] ?? 'secondary'
  );
}

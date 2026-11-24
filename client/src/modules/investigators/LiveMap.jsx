import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import PageHeader, { Panel } from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { AvailabilityBadge } from '../../components/Badges';
import { useRealtime } from '../../hooks/useRealtime';
import { mapsConfigured } from '../../lib/googleMaps';
import { timeAgo } from '../../utils/timeAgo';

const InvestigatorMap = lazy(() => import('../../components/InvestigatorMap'));

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Live investigator positions.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  GOOGLE MAPS WHEN A KEY IS CONFIGURED (`VITE_GOOGLE_MAPS_API_KEY`), and the
 *  key-less projection of Egypt otherwise — the screen still works on a
 *  deployment that has not set one up, it just has no basemap.
 *
 *  LIVE, BUT BY SIGNAL. The handset reports its position about once a minute
 *  while the investigator is on shift; the server sends `investigator:location`
 *  with only an id, and this screen refetches over REST behind
 *  `investigators.view_location`. The 60-second poll is the fallback for a
 *  dropped socket, not the mechanism.
 *
 *  Clicking a pin draws that investigator's track since midnight.
 *
 *  STALENESS IS SHOWN, NOT HIDDEN. A pin from an hour ago is faded and
 *  labelled; a coordinator routes work on this map.
 */

export default function LiveMap() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['live-map'],
    queryFn: async () => (await api.get('/investigators/live-map')).data,
    refetchInterval: 60_000,
  });

  const selected = (data ?? []).find((row) => row.id === selectedId) ?? null;

  const { data: track } = useQuery({
    queryKey: ['live-map-track', selectedId],
    enabled: Boolean(selectedId) && mapsConfigured,
    queryFn: async () => {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      return (
        await api.get(`/gps/investigator/${selectedId}`, {
          params: { from: midnight.toISOString() },
        })
      ).data;
    },
  });

  // Several investigators report within the same second; one refetch covers
  // them all.
  const debounce = useRef(null);
  useRealtime('investigator:location', ({ investigatorId } = {}) => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['live-map'] });
      if (investigatorId && investigatorId === selectedId) {
        queryClient.invalidateQueries({
          queryKey: ['live-map-track', selectedId],
        });
      }
    }, 1500);
  });

  const pins = useMemo(
    () => (data ?? []).filter((row) => row.lat != null && row.lng != null),
    [data],
  );

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const select = (pin) => setSelectedId(pin?.id ?? null);

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
                <span
                  className="placeholder w-100 d-block rounded"
                  style={{ height: 520 }}
                />
              </div>
            ) : pins.length === 0 ? (
              <EmptyState
                title={t('investigators.noLocation')}
                icon="geo-alt"
              />
            ) : mapsConfigured ? (
              <Suspense
                fallback={
                  <div className="placeholder-glow">
                    <span
                      className="placeholder w-100 d-block rounded"
                      style={{ height: 520 }}
                    />
                  </div>
                }
              >
                <InvestigatorMap
                  pins={pins}
                  selectedId={selectedId}
                  track={track}
                  onSelect={select}
                />
              </Suspense>
            ) : (
              <ProjectionMap pins={pins} onSelect={select} />
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
                    {t('investigators.locationUpdated', {
                      ago: timeAgo(selected.updatedAt, i18n.language),
                    })}
                    {mapsConfigured && track && (
                      <>
                        {' · '}
                        {t('investigators.trackPoints', {
                          count: track.length,
                        })}
                      </>
                    )}
                  </div>
                </div>
                <a
                  className="btn btn-sm btn-outline-primary"
                  href={`https://www.google.com/maps?q=${selected.lat},${selected.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <i
                    className="bi bi-box-arrow-up-right me-1"
                    aria-hidden="true"
                  />
                  {t('investigators.openInGoogleMaps')}
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
                    selectedId === investigator.id ? 'bg-body-tertiary' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => select(investigator)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') select(investigator);
                  }}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div className="min-vw-0">
                      <div className="truncate fw-medium">
                        {investigator.fullName}
                      </div>
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
                          {t('investigators.locationUpdated', {
                            ago: timeAgo(investigator.updatedAt, i18n.language),
                          })}
                        </div>
                      )}
                    </div>
                    <AvailabilityBadge
                      availability={investigator.availability}
                    />
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

/**
 * The key-less view: OpenStreetMap tiles drawn as a still image, pins on top.
 *
 * TEMPORARY, until a Google Maps key is configured. No library: the tiles are
 * plain <img> elements on the standard Web-Mercator grid, the zoom is chosen
 * so every pin fits, and the view does not pan or zoom. OSM's tile servers are
 * fine for this volume (a handful of coordinators) but are not a production
 * service — their usage policy asks for attribution, which is shown.
 *
 * GEOGRAPHY DOES NOT FLIP. East is on the right in Arabic too, so this box is
 * laid out with physical `left`/`top` under `direction: ltr` on purpose — the
 * one place where logical properties would be wrong.
 */
const TILE = 256;
const TILE_URL = 'https://tile.openstreetmap.org';

function worldPx(lat, lng, zoom) {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function ProjectionMap({ pins, onSelect }) {
  const { t, i18n } = useTranslation();
  const boxRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        w: Math.round(entry.contentRect.width),
        h: Math.round(entry.contentRect.height),
      }),
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const view = useMemo(() => {
    if (!size.w || !size.h || pins.length === 0) return null;
    const padding = 60;

    // The highest zoom at which every pin still fits, capped at street level.
    let zoom = 15;
    for (; zoom > 3; zoom -= 1) {
      const points = pins.map((p) => worldPx(p.lat, p.lng, zoom));
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      if (
        Math.max(...xs) - Math.min(...xs) <= size.w - padding * 2 &&
        Math.max(...ys) - Math.min(...ys) <= size.h - padding * 2
      ) {
        break;
      }
    }

    const points = pins.map((p) => worldPx(p.lat, p.lng, zoom));
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const originX = (Math.min(...xs) + Math.max(...xs)) / 2 - size.w / 2;
    const originY = (Math.min(...ys) + Math.max(...ys)) / 2 - size.h / 2;

    const tiles = [];
    const count = 2 ** zoom;
    for (
      let ty = Math.floor(originY / TILE);
      ty * TILE < originY + size.h;
      ty += 1
    ) {
      if (ty < 0 || ty >= count) continue;
      for (
        let tx = Math.floor(originX / TILE);
        tx * TILE < originX + size.w;
        tx += 1
      ) {
        const wrapped = ((tx % count) + count) % count;
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          src: `${TILE_URL}/${zoom}/${wrapped}/${ty}.png`,
          left: tx * TILE - originX,
          top: ty * TILE - originY,
        });
      }
    }

    return {
      tiles,
      pins: pins.map((pin, index) => ({
        ...pin,
        left: points[index].x - originX,
        top: points[index].y - originY,
      })),
    };
  }, [pins, size]);

  return (
    <div
      className="map-canvas map-tiles"
      ref={boxRef}
      style={{ direction: 'ltr' }}
    >
      {view?.tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.src}
          alt=""
          width={TILE}
          height={TILE}
          draggable={false}
          referrerPolicy="strict-origin-when-cross-origin"
          className="map-tile"
          style={{ left: tile.left, top: tile.top }}
        />
      ))}

      {view?.pins.map((pin) => {
        const stale = (pin.staleMinutes ?? 0) > 60;
        return (
          <button
            key={pin.id}
            type="button"
            className="map-pin btn p-0 border-0 bg-transparent"
            style={{ left: pin.left, top: pin.top, opacity: stale ? 0.45 : 1 }}
            onClick={() => onSelect(pin)}
            title={`${pin.fullName} · ${t('investigators.locationUpdated', {
              ago: timeAgo(pin.updatedAt, i18n.language),
            })}`}
          >
            <i
              className={`bi bi-geo-alt-fill fs-3 text-${toneFor(pin.availability)}`}
              aria-hidden="true"
            />
            <span className="visually-hidden">{pin.fullName}</span>
          </button>
        );
      })}

      <div className="map-note small p-2" dir={i18n.dir()}>
        {t('investigators.mapNoKey')}
      </div>
      <div className="map-attribution">
        ©{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenStreetMap
        </a>
      </div>
    </div>
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

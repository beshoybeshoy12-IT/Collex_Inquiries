import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAP_ID, loadGoogleMaps } from '../lib/googleMaps';
import { useTheme } from '../theme';
import { timeAgo } from '../utils/timeAgo';

/**
 * Investigator positions on a Google map, plus the selected one's track.
 *
 * One map instance for the life of the component. Markers are diffed by
 * investigator id rather than rebuilt, so a refetch every minute does not make
 * the pins flicker or reset an open selection.
 *
 * Stale pins are faded, exactly as in the key-less view: a coordinator routes
 * work on this map, and an hour-old fix presented as current is worse than no
 * fix at all.
 */

// Cairo — where the map opens before there is anything to fit to.
const DEFAULT_CENTER = { lat: 30.0444, lng: 31.2357 };
const STALE_MINUTES = 60;

const TONE = {
  AVAILABLE: 'success',
  ONLINE: 'info',
  BUSY: 'warning',
  ON_VISIT: 'primary',
  EN_ROUTE: 'primary',
  ON_LEAVE: 'dark',
  OFFLINE: 'secondary',
};

function cssColor(tone) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--bs-${tone}`)
    .trim();
  return value || '#6c757d';
}

/**
 * @param {{
 *   pins: Array<{ id: string, fullName: string, lat: number, lng: number,
 *                 availability: string, staleMinutes: number | null }>,
 *   selectedId?: string | null,
 *   track?: Array<{ lat: number, lng: number }>,
 *   onSelect?: (pin: object) => void,
 * }} props
 */
export default function InvestigatorMap({ pins, selectedId, track, onSelect }) {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const polylineRef = useRef(null);
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [maps, setMaps] = useState(null);
  const [failed, setFailed] = useState(false);

  // Load the API once. Language is fixed for the page's lifetime.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(i18n.language?.startsWith('en') ? 'en' : 'ar')
      .then(async (googleMaps) => {
        await Promise.all([
          googleMaps.importLibrary('maps'),
          googleMaps.importLibrary('marker'),
        ]);
        if (!cancelled) setMaps(googleMaps);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create the map. A colour scheme can only be chosen at construction, so a
  // theme switch rebuilds the map (markers are re-attached below).
  useEffect(() => {
    if (!maps || !containerRef.current) return undefined;

    const map = new maps.Map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 11,
      mapId: MAP_ID,
      colorScheme: theme === 'dark' ? 'DARK' : 'LIGHT',
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: true,
      clickableIcons: false,
    });
    mapRef.current = map;
    fittedRef.current = false;

    const markers = markersRef.current;
    return () => {
      markers.forEach((marker) => {
        marker.map = null;
      });
      markers.clear();
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      mapRef.current = null;
    };
  }, [maps, theme]);

  // Diff markers against the pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!maps || !map) return;

    const markers = markersRef.current;
    const seen = new Set();

    pins.forEach((pin) => {
      seen.add(pin.id);
      const stale = (pin.staleMinutes ?? 0) > STALE_MINUTES;
      const selected = pin.id === selectedId;
      const color = cssColor(TONE[pin.availability] ?? 'secondary');

      const glyph = new maps.marker.PinElement({
        background: color,
        borderColor: selected ? '#000' : color,
        glyphColor: '#fff',
        scale: selected ? 1.3 : 1,
      });
      glyph.element.style.opacity = stale ? '0.45' : '1';

      const title = `${pin.fullName} · ${t('investigators.locationUpdated', {
        ago: timeAgo(pin.updatedAt, i18n.language),
      })}`;

      let marker = markers.get(pin.id);
      if (!marker) {
        marker = new maps.marker.AdvancedMarkerElement({
          map,
          gmpClickable: true,
        });
        marker.addListener('click', () => onSelectRef.current?.(marker.__pin));
        markers.set(pin.id, marker);
      }
      marker.__pin = pin;
      marker.position = { lat: pin.lat, lng: pin.lng };
      marker.title = title;
      marker.content = glyph.element;
      marker.zIndex = selected ? 1000 : stale ? 1 : 10;
    });

    markers.forEach((marker, id) => {
      if (!seen.has(id)) {
        marker.map = null;
        markers.delete(id);
      }
    });

    // Fit once per map, so a refetch never yanks the view away from where the
    // coordinator has panned to.
    if (!fittedRef.current && pins.length > 0) {
      fittedRef.current = true;
      if (pins.length === 1) {
        map.setCenter({ lat: pins[0].lat, lng: pins[0].lng });
        map.setZoom(14);
      } else {
        const bounds = new maps.LatLngBounds();
        pins.forEach((pin) => bounds.extend({ lat: pin.lat, lng: pin.lng }));
        map.fitBounds(bounds, 48);
      }
    }
  }, [maps, pins, selectedId, theme, t, i18n.language]);

  // The selected investigator's track for today.
  useEffect(() => {
    const map = mapRef.current;
    if (!maps || !map) return;

    polylineRef.current?.setMap(null);
    polylineRef.current = null;
    if (!track || track.length < 2) return;

    polylineRef.current = new maps.Polyline({
      map,
      path: track.map((point) => ({ lat: point.lat, lng: point.lng })),
      strokeColor: cssColor('primary'),
      strokeOpacity: 0.85,
      strokeWeight: 4,
      geodesic: false,
    });
  }, [maps, track, theme]);

  // Pan to a pin chosen from the list beside the map.
  useEffect(() => {
    const map = mapRef.current;
    const pin = pins.find((p) => p.id === selectedId);
    if (map && pin) map.panTo({ lat: pin.lat, lng: pin.lng });
    // Only when the selection changes — not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, maps]);

  if (failed) {
    return (
      <div className="map-canvas d-flex align-items-center justify-content-center text-body-secondary small p-3 text-center">
        <span>
          <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
          {t('investigators.mapUnavailable')}
        </span>
      </div>
    );
  }

  return (
    <div className="map-canvas">
      <div ref={containerRef} className="w-100 h-100" />
      {!maps && (
        <div
          className="position-absolute placeholder-glow"
          style={{ inset: 0 }}
        >
          <span className="placeholder w-100 h-100 d-block" />
        </div>
      )}
    </div>
  );
}

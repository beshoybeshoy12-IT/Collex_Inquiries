/**
 * Google Maps JavaScript API, loaded once, on demand.
 *
 * No npm wrapper: the official script tag with `loading=async` and
 * `importLibrary()` is the whole integration, and it keeps the map off the
 * critical path — nothing is fetched until a screen with a map mounts.
 *
 * THE KEY IS A BROWSER KEY, NOT A SECRET. Google's JS API key is visible to
 * anyone who opens the page by design; what protects it is the HTTP-referrer
 * and API restrictions set on it in the Google Cloud console. It still comes
 * from the environment (`VITE_GOOGLE_MAPS_API_KEY`), never from the source, so
 * each deployment uses its own restricted key and its own bill.
 *
 * Without a key, `mapsConfigured` is false and screens fall back to their
 * key-less view instead of loading a map that would only show an error.
 */

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

/**
 * Advanced markers need a Map ID. `DEMO_MAP_ID` is Google's documented id for
 * development; a production deployment creates its own in the console.
 */
export const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

export const mapsConfigured = Boolean(API_KEY);

let loading = null;

/**
 * Load the API and resolve with `google.maps`.
 *
 * `language` is fixed at load time — Google offers no way to switch it on a
 * live page — so a language change shows the new labels on the next visit.
 */
export function loadGoogleMaps(language = 'ar') {
  if (!mapsConfigured) {
    return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not set'));
  }
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const callback = `__ciGoogleMapsReady${Date.now()}`;
    window[callback] = () => {
      delete window[callback];
      resolve(window.google.maps);
    };

    const params = new URLSearchParams({
      key: API_KEY,
      v: 'weekly',
      loading: 'async',
      language,
      region: 'EG',
      callback,
    });

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      delete window[callback];
      script.remove();
      reject(new Error('Google Maps failed to load'));
    };
    document.head.appendChild(script);
  });

  return loading;
}

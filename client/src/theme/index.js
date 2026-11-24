import { useSyncExternalStore } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Light and dark mode.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Bootstrap 5.3 reads `data-bs-theme` on <html> and swaps every `--bs-*`
 *  variable; `app.css` builds its own tokens on top of those, so one attribute
 *  re-colours the whole application. Nothing here touches a component.
 *
 *  Three preferences, two results: `light`, `dark`, or `system`, which follows
 *  the operating system live — someone whose laptop goes dark at sunset should
 *  not have to come back and change a setting.
 *
 *  THE FIRST PAINT. `index.html` carries a five-line inline copy of `resolve()`
 *  that sets the attribute before any stylesheet or script loads. Without it
 *  a dark-mode user gets a white flash on every reload, which is the single
 *  most noticeable defect a dark mode can have. Keep the storage key and the
 *  logic there in step with this file.
 */

const STORAGE_KEY = 'collex-inq-theme';
export const THEME_PREFERENCES = ['light', 'dark', 'system'];

const media =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

const listeners = new Set();

function readPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEME_PREFERENCES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

let preference = readPreference();

/** @param {string} pref @returns {'light'|'dark'} */
function resolve(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return media?.matches ? 'dark' : 'light';
}

function apply() {
  const theme = resolve(preference);
  document.documentElement.setAttribute('data-bs-theme', theme);
  // The browser chrome on phones follows the page.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0a0b' : '#f4f6fb');
  listeners.forEach((listener) => listener());
}

media?.addEventListener?.('change', () => {
  if (preference === 'system') apply();
});

apply();

/** @param {'light'|'dark'|'system'} next */
export function setThemePreference(next) {
  if (!THEME_PREFERENCES.includes(next)) return;
  preference = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing: the choice lasts for this tab only.
  }
  apply();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => `${preference}|${resolve(preference)}`;

/**
 * The current preference and what it resolves to, re-rendering on change.
 * @returns {{ preference: 'light'|'dark'|'system', theme: 'light'|'dark' }}
 */
export function useTheme() {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [pref, theme] = value.split('|');
  return { preference: pref, theme };
}

/**
 * Colours for chart.js, which draws on a canvas and cannot read CSS. Taken
 * from the live custom properties, so charts follow the theme like the rest.
 * @returns {{ text: string, grid: string, series: string[] }}
 */
export function chartColors() {
  const css = getComputedStyle(document.documentElement);
  const read = (name) => css.getPropertyValue(name).trim();
  return {
    text: read('--ci-chart-text'),
    grid: read('--ci-chart-grid'),
    series: [1, 2, 3, 4, 5].map((n) => read(`--ci-chart-${n}`)),
  };
}

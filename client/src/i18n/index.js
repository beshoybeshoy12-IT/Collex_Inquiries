import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';
// `?url` yields the asset's URL rather than injecting the stylesheet, which is
// what makes a single swappable <link> possible.
import bootstrapRtlUrl from 'bootstrap/dist/css/bootstrap.rtl.min.css?url';
import bootstrapLtrUrl from 'bootstrap/dist/css/bootstrap.min.css?url';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Localisation and direction.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  THE LAYOUT GENUINELY FLIPS. Arabic renders right-to-left and English
 *  left-to-right, and `applyDirection` swaps the Bootstrap stylesheet to match.
 *  Collex System V1 pins `dir="rtl"` unconditionally and only swaps the words;
 *  that is a shortcut, and it leaves the English UI reading backwards.
 *
 *  Because the direction really changes, the CSS must not assume one. Every
 *  rule in this application uses logical properties — `margin-inline-start`,
 *  `border-inline-end`, `inset-inline-start` — rather than left and right.
 *  Bootstrap 5 handles its own half through the RTL build.
 *
 *  DIRECTION IS APPLIED BEFORE REACT MOUNTS. A page that paints left-to-right
 *  and then flips is visibly broken for that moment, so `main.jsx` calls this
 *  first.
 */

export const LANGUAGES = {
  ar: { code: 'ar', name: 'العربية', dir: 'rtl', flag: 'EG' },
  en: { code: 'en', name: 'English', dir: 'ltr', flag: 'GB' },
};

const STORAGE_KEY = 'collex-inq-lang';

export function storedLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES[saved]) return saved;
  } catch {
    // Private browsing, or storage disabled. Fall through to the default.
  }
  return 'ar';
}

/**
 * Swap the Bootstrap stylesheet for the direction.
 *
 * ONE `<link>`, whose href changes. Not `await import()`, which is what this
 * did first and which is broken in a way that only appears on the SECOND
 * switch:
 *
 *   - a dynamic `import()` of a stylesheet injects it and caches the module,
 *     so going ar → en → ar re-imports the RTL build, gets the cache, and
 *     injects nothing;
 *   - the LTR build injected on the way through is still in the document, and
 *     is now the LAST stylesheet, so it wins every conflict;
 *   - the result is both builds live at once. `.me-2` sets margin on BOTH
 *     sides, and `.text-start` resolves to `left` under `dir="rtl"` — Arabic
 *     labels sit against the wrong edge of their own container.
 *
 * The old code tried to clean up with
 * `querySelectorAll('style[data-bootstrap-dir]')`, but nothing ever set that
 * attribute, so it matched nothing and removed nothing.
 *
 * A link element is addressable and swappable, which a cached module is not.
 * It is PREPENDED to <head> so Bootstrap comes before this application's own
 * stylesheet and app.css can override it on ordinary specificity.
 */
const BOOTSTRAP_LINK_ID = 'ci-bootstrap-css';

let loadedDirection = null;

function applyBootstrapFor(dir) {
  if (loadedDirection === dir) return;
  loadedDirection = dir;

  const href = dir === 'rtl' ? bootstrapRtlUrl : bootstrapLtrUrl;

  let link = document.getElementById(BOOTSTRAP_LINK_ID);
  if (!link) {
    link = document.createElement('link');
    link.id = BOOTSTRAP_LINK_ID;
    link.rel = 'stylesheet';
    document.head.prepend(link);
  }

  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

export function applyDirection(language) {
  const { dir } = LANGUAGES[language] ?? LANGUAGES.ar;

  document.documentElement.setAttribute('lang', language);
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.dataset.lang = language;

  applyBootstrapFor(dir);
  return dir;
}

export function setLanguage(language) {
  if (!LANGUAGES[language]) return;

  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not fatal — the choice just will not survive a reload.
  }

  applyDirection(language);
  return i18next.changeLanguage(language);
}

const initial = storedLanguage();

i18next.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: initial,
  fallbackLng: 'en',
  interpolation: {
    // React escapes for us; double-escaping turns an Arabic apostrophe into
    // an entity on screen.
    escapeValue: false,
  },
  returnEmptyString: false,
  // A missing key renders as the key itself, which is loud in development and
  // still legible in production — unlike an empty string, which renders as a
  // blank button nobody can identify.
  parseMissingKeyHandler: (key) => key,
});

applyDirection(initial);

export default i18next;

/**
 * A bilingual record's name in the current language.
 *
 * Business entities carry `nameAr` and `nameEn` and are identified by a stable
 * `code` — the display name is never the identifier. This is the one helper
 * that reads them, so a record with only one of the two still shows something
 * rather than "undefined".
 */
export function localisedName(record, language = i18next.language) {
  if (!record) return '';
  if (language === 'ar') return record.nameAr || record.nameEn || record.code || '';
  return record.nameEn || record.nameAr || record.code || '';
}

/** Same, for the title/label pair on form sections and fields. */
export function localisedLabel(record, language = i18next.language) {
  if (!record) return '';
  if (language === 'ar') {
    return record.labelAr || record.titleAr || record.labelEn || record.titleEn || '';
  }
  return record.labelEn || record.titleEn || record.labelAr || record.titleAr || '';
}

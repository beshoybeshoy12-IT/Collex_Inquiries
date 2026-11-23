import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager, Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import ar from '../locales/ar.json';
import en from '../locales/en.json';
import { local } from './storage';

/**
 * Arabic first, English second — the same rule as the office client.
 *
 * Direction on a phone is not a stylesheet swap: React Native lays out from
 * I18nManager, which is read when the app starts. Changing language flips
 * the text at once, and flips the layout the next time the app opens
 * (forceRTL + a restart is how React Native does it; see SDK 58's
 * localization guide). On the web preview, `dir` on <html> does it live.
 */
const KEY = 'collex-field-language';

export const LANGUAGES = { ar: 'العربية', en: 'English' };

function deviceLanguage() {
  const code = getLocales()?.[0]?.languageCode;
  return code === 'en' ? 'en' : 'ar';
}

export function applyDirection(language) {
  const rtl = language === 'ar';
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
      document.documentElement.setAttribute('lang', language);
    }
    return;
  }
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
}

i18next.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: deviceLanguage(),
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
});

/** Restore the stored choice once storage is readable. */
export async function loadLanguage() {
  const stored = await local.getJson(KEY);
  const language = stored === 'en' || stored === 'ar' ? stored : deviceLanguage();
  applyDirection(language);
  await i18next.changeLanguage(language);
}

export async function setLanguage(language) {
  await local.setJson(KEY, language);
  applyDirection(language);
  await i18next.changeLanguage(language);
}

/** `nameAr`/`nameEn` (or `labelAr`/`labelEn`) for the current language. */
export function localised(record, language = i18next.language) {
  if (!record) return '';
  const ar = record.nameAr ?? record.labelAr ?? record.titleAr;
  const en = record.nameEn ?? record.labelEn ?? record.titleEn;
  return (language === 'ar' ? ar || en : en || ar) ?? record.code ?? '';
}

export default i18next;

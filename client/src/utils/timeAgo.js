/**
 * "منذ 7 دقائق" / "7 minutes ago", in the unit a person would use.
 *
 * Under a minute → seconds; up to 90 minutes → minutes; up to 36 hours →
 * hours; up to 45 days → days; then months and years. `Intl.RelativeTimeFormat`
 * does the wording, so Arabic plural forms (دقيقة / دقيقتين / دقائق) are right
 * without a translation key per unit.
 *
 * @param {string | number | Date | null | undefined} value  the past moment
 * @param {string} [language]  i18next language, e.g. 'ar' or 'en'
 * @returns {string} empty string when there is no date
 */
export function timeAgo(value, language = 'ar') {
  if (value == null) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';

  // A clock slightly ahead of ours must not read "in 3 seconds".
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;

  const format = new Intl.RelativeTimeFormat(
    language?.startsWith('en') ? 'en' : 'ar',
    { numeric: 'always' },
  );

  if (seconds < 60) return format.format(-seconds, 'second');
  if (minutes <= 90) return format.format(-Math.round(minutes), 'minute');
  if (hours <= 36) return format.format(-Math.round(hours), 'hour');
  if (days <= 45) return format.format(-Math.round(days), 'day');
  if (days < 365) return format.format(-Math.round(days / 30), 'month');
  return format.format(-Math.round(days / 365), 'year');
}

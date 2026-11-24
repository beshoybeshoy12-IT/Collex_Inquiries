/**
 * Small time formatters for the attendance screens.
 */

/** 3725 → "01:02:05". */
export function clockDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds ?? 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** 3725 → "1س 2د" / "1h 2m" — compact, for tables. */
export function shortDuration(totalSeconds, language = 'ar') {
  const seconds = Math.max(0, Math.floor(totalSeconds ?? 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const [hs, ms] = language?.startsWith('en') ? ['h', 'm'] : ['س', 'د'];
  if (h === 0) return `${m}${ms}`;
  return `${h}${hs} ${m}${ms}`;
}

/** A time of day in the reader's language: "09:05 ص" / "9:05 AM". */
export function timeOfDay(value, language = 'ar') {
  if (!value) return '—';
  return new Intl.DateTimeFormat(language?.startsWith('en') ? 'en-GB' : 'ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !language?.startsWith('en'),
  }).format(new Date(value));
}

/** Initials for an avatar: "محمود السيد" → "مس". */
export function initialsOf(name) {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
}

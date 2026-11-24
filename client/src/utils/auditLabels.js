/**
 * Audit entries, in words a person reads.
 *
 * The server stores codes — `CASE_EN_ROUTE`, `status: ACCEPTED → EN_ROUTE`,
 * `formVersionId: <uuid>` — because codes are stable and searchable. These
 * helpers turn them into sentences for the screen; the codes stay available
 * on hover for whoever needs the exact value.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** "SOME_CODE" → "Some code", for anything without a translation yet. */
function humanize(code) {
  const words = String(code).toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The sentence for an action code. */
export function actionLabel(action, t, i18n) {
  if (i18n.exists(`auditActions.${action}`)) return t(`auditActions.${action}`);

  // Status moves are written as CASE_<STATUS>.
  const status = action?.startsWith('CASE_') ? action.slice(5) : null;
  if (status && i18n.exists(`status.${status}`)) {
    return t('auditActions.movedTo', { status: t(`status.${status}`) });
  }
  return humanize(action ?? '');
}

export function severityLabel(severity, t, i18n) {
  return i18n.exists(`auditSeverity.${severity}`)
    ? t(`auditSeverity.${severity}`)
    : humanize(severity);
}

export function fieldLabel(key, t, i18n) {
  return i18n.exists(`auditFields.${key}`) ? t(`auditFields.${key}`) : humanize(key);
}

/**
 * One value, readable. Returns `null` for an internal id: "investigator
 * changed" is what a reader needs, not two UUIDs.
 */
export function valueLabel(key, value, t, i18n) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return t(value ? 'auditMisc.yes' : 'auditMisc.no');
  if (typeof value === 'string') {
    if (UUID.test(value)) return null;
    if (key === 'status' && i18n.exists(`status.${value}`)) return t(`status.${value}`);
    if (key === 'priority' && i18n.exists(`priority.${value}`)) return t(`priority.${value}`);
    if (ISO_DATE.test(value)) {
      return new Date(value).toLocaleString(i18n.language === 'en' ? 'en-GB' : 'ar-EG');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => valueLabel(key, item, t, i18n)).join('، ');
  return JSON.stringify(value);
}

/**
 * The changes in one entry as lines: `{ key, label, from, to, idOnly }`.
 * When a diff changes both a code and its id (form + formVersionId), the id
 * line is dropped — the code already says it.
 */
export function changeLines(oldValue, newValue, t, i18n) {
  const keys = Object.keys(newValue ?? {});
  return keys
    .map((key) => {
      const from = valueLabel(key, oldValue?.[key], t, i18n);
      const to = valueLabel(key, newValue[key], t, i18n);
      return {
        key,
        label: fieldLabel(key, t, i18n),
        from,
        to,
        idOnly: to === null || from === null,
      };
    })
    .filter((line) => !(line.idOnly && keys.length > 1 && /Id$/.test(line.key)));
}

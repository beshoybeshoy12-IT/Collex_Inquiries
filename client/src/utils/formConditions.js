/**
 * The client-side twin of the server's `isVisible` (server/src/forms/form-schema.ts).
 *
 * Both read the same `visibleWhen` data from the same schema, so a field the
 * investigator never saw is skipped identically on screen and in the answer
 * validator. Keeping them in step matters: if this one is more permissive, a
 * question that was never asked shows up as unanswered.
 *
 * Like the server, an object answer (GPS, a repeating group) has no scalar to
 * compare and reads as empty, so two unrelated objects never compare equal.
 *
 * @param {Array<{field: string, operator: string, value?: unknown}>|undefined} conditions
 * @param {Record<string, unknown>} answers
 * @returns {boolean}
 */
export function conditionsMet(conditions, answers) {
  if (!conditions?.length) return true;

  return conditions.every((condition) => {
    const actual = answers[condition.field];

    switch (condition.operator) {
      case 'EQUALS':
        return comparable(actual) === comparable(condition.value);
      case 'NOT_EQUALS':
        return comparable(actual) !== comparable(condition.value);
      case 'IN':
        return (
          Array.isArray(condition.value) &&
          condition.value.map(comparable).includes(comparable(actual))
        );
      case 'NOT_IN':
        return (
          Array.isArray(condition.value) &&
          !condition.value.map(comparable).includes(comparable(actual))
        );
      case 'IS_EMPTY':
        return isEmptyAnswer(actual);
      case 'IS_NOT_EMPTY':
        return !isEmptyAnswer(actual);
      default:
        return true;
    }
  });
}

/** @param {unknown} value */
function comparable(value) {
  if (value === null || value === undefined || typeof value === 'object') return '';
  return String(value);
}

/** @param {unknown} value */
export function isEmptyAnswer(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

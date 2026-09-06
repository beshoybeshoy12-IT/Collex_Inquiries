/**
 * Phone numbers, for comparison only.
 *
 * Bank files write the same handset four ways — `01001234567`,
 * `+201001234567`, `0020 100 123 4567`, `100-123-4567` — and duplicate
 * detection has to see through all of them. What this does NOT do is normalise
 * a number for *dialling*: there is no dial plan here, no assumed country, and
 * nothing rewrites a stored value. The original string is kept exactly as the
 * client sent it, and only a derived comparable form is matched on.
 *
 * The last nine digits are the comparison key. Egyptian mobiles are ten digits
 * after the leading zero (`0100 123 4567`), so nine is enough to be specific
 * while surviving every prefix variation above — and short enough that a
 * landline written with and without its area code still matches.
 */

const COMPARABLE_DIGITS = 9;

/** Digits only, or null if there are not enough to compare meaningfully. */
export function comparablePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Arabic-Indic digits appear in files typed on an Arabic keyboard.
  const digits = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');

  if (digits.length < COMPARABLE_DIGITS) return null;
  return digits.slice(-COMPARABLE_DIGITS);
}

/** Whether two numbers are plausibly the same handset. */
export function samePhone(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = comparablePhone(a);
  const right = comparablePhone(b);
  return left !== null && left === right;
}

/**
 * Whether a string looks like a phone number at all.
 *
 * Deliberately permissive: this is used by the import validator to flag a cell
 * that is obviously not a phone (an email, a date, a name), not to enforce a
 * numbering plan. Rejecting a valid foreign number because it does not match an
 * Egyptian pattern would block real work.
 */
export function looksLikePhone(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * A national id, digits only.
 *
 * Egyptian national ids are 14 digits. The check is a length check and nothing
 * more — the embedded checksum and birth-date fields are real, but a file that
 * fails a checksum is usually a transcription error the operator must fix by
 * looking at the customer's card, not a row the software should silently
 * reject.
 */
export function normaliseNationalId(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const digits = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export function looksLikeNationalId(raw: string | null | undefined): boolean {
  const digits = normaliseNationalId(raw);
  return digits !== null && digits.length === 14;
}

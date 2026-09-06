import {
  comparablePhone,
  looksLikeNationalId,
  looksLikePhone,
  normaliseNationalId,
  samePhone,
} from './phone.util';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Phone and national-id comparison.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Duplicate detection rests on this. A bank file writes the same handset four
 *  ways — `01001234567`, `+201001234567`, `0020 100 123 4567`, `100-123-4567`
 *  — and if these do not compare equal, the same customer is created four
 *  times and four investigators drive to the same door.
 *
 *  The property that matters most is the one asserted last and hardest: THE
 *  ORIGINAL STRING IS NEVER REWRITTEN. There is no dial plan here and no
 *  assumed country. `comparablePhone` derives a matching key; it is not a
 *  normaliser, and nothing stores its output in place of what the client sent.
 *  A system that "helpfully" rewrites `+201001234567` to `01001234567` has
 *  destroyed information the moment a non-Egyptian number arrives.
 */

describe('comparablePhone', () => {
  it('reduces every way a bank file writes one handset to the same key', () => {
    // The whole reason this function exists.
    const written = [
      '01001234567',
      '+201001234567',
      '0020 100 123 4567',
      '0100-123-4567',
      '(0100) 123 4567',
      '0100.123.4567',
    ];
    const keys = written.map(comparablePhone);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('001234567');
  });

  it('keeps two different handsets apart', () => {
    expect(comparablePhone('01001234567')).not.toBe(
      comparablePhone('01009999999'),
    );
  });

  it('reads Arabic-Indic digits, which arrive from Arabic keyboards', () => {
    // ٠١٠٠١٢٣٤٥٦٧ is the same number typed on an Arabic layout. Treating
    // these as non-digits would strip the whole value and match everything
    // against nothing.
    expect(comparablePhone('٠١٠٠١٢٣٤٥٦٧')).toBe('001234567');
    expect(comparablePhone('٠١٠٠١٢٣٤٥٦٧')).toBe(comparablePhone('01001234567'));
  });

  it('reads Extended Arabic-Indic (Persian) digits too', () => {
    expect(comparablePhone('۰۱۰۰۱۲۳۴۵۶۷')).toBe('001234567');
  });

  it('matches a landline written with and without its area code', () => {
    expect(comparablePhone('0223456789')).toBe(comparablePhone('223456789'));
  });

  it('refuses a value with too few digits to be specific', () => {
    // Nine digits is the comparison key. Matching on fewer would collide
    // wildly — an extension number is not a handset.
    expect(comparablePhone('1234')).toBeNull();
    expect(comparablePhone('12345678')).toBeNull();
    expect(comparablePhone('123456789')).toBe('123456789');
  });

  it('returns null for blanks and for text with no digits', () => {
    expect(comparablePhone(null)).toBeNull();
    expect(comparablePhone(undefined)).toBeNull();
    expect(comparablePhone('')).toBeNull();
    expect(comparablePhone('no phone')).toBeNull();
    expect(comparablePhone('   ')).toBeNull();
  });

  it('never returns the input unchanged for a formatted number', () => {
    // A guard against a future "optimisation" that returns the raw string
    // when it already looks clean — which would make matching depend on
    // formatting again.
    expect(comparablePhone('+20 100 123 4567')).not.toBe('+20 100 123 4567');
  });
});

describe('samePhone', () => {
  it('is true across formatting differences', () => {
    expect(samePhone('01001234567', '+20 100 123 4567')).toBe(true);
    expect(samePhone('0020-100-1234567', '01001234567')).toBe(true);
  });

  it('is false for different handsets', () => {
    expect(samePhone('01001234567', '01112345678')).toBe(false);
  });

  it('is false when either side is missing', () => {
    // Two customers with no phone are NOT the same customer. A null-equals-null
    // match here would merge every phoneless record in the tenant into one.
    expect(samePhone(null, null)).toBe(false);
    expect(samePhone(undefined, undefined)).toBe(false);
    expect(samePhone('01001234567', null)).toBe(false);
    expect(samePhone(null, '01001234567')).toBe(false);
    expect(samePhone('', '')).toBe(false);
  });

  it('is false when either side is too short to compare', () => {
    expect(samePhone('1234', '1234')).toBe(false);
  });

  it('is reflexive for a real number', () => {
    expect(samePhone('01001234567', '01001234567')).toBe(true);
  });

  it('is symmetric', () => {
    expect(samePhone('01001234567', '+201001234567')).toBe(
      samePhone('+201001234567', '01001234567'),
    );
  });
});

describe('looksLikePhone', () => {
  it.each([
    '01001234567',
    '+201001234567',
    '0223456789',
    '+44 20 7123 4567',
    '1234567',
  ])('accepts %s', (value) => {
    expect(looksLikePhone(value)).toBe(true);
  });

  it('accepts a foreign number rather than enforcing an Egyptian plan', () => {
    // This flags cells that are obviously not phones. Rejecting a valid
    // foreign number because it does not match an Egyptian pattern would
    // block real work on a real case.
    expect(looksLikePhone('+44 20 7123 4567')).toBe(true);
    expect(looksLikePhone('+1 415 555 0142')).toBe(true);
  });

  it.each([
    ['ahmed@example.com', 'an email'],
    ['call the office', 'free text'],
    ['', 'an empty cell'],
    ['123456', 'too few digits'],
    ['1234567890123456', 'too many digits'],
  ])('rejects %s (%s)', (value) => {
    expect(looksLikePhone(value)).toBe(false);
  });

  it('rejects blanks', () => {
    expect(looksLikePhone(null)).toBe(false);
    expect(looksLikePhone(undefined)).toBe(false);
  });
});

describe('normaliseNationalId', () => {
  it('strips punctuation and spacing', () => {
    expect(normaliseNationalId('290-0101-1234567')).toBe('29001011234567');
    expect(normaliseNationalId(' 2900 1011 234567 ')).toBe('29001011234567');
  });

  it('reads Arabic-Indic digits', () => {
    expect(normaliseNationalId('٢٩٠٠١٠١١٢٣٤٥٦٧')).toBe('29001011234567');
  });

  it('returns null when there is nothing numeric to keep', () => {
    expect(normaliseNationalId(null)).toBeNull();
    expect(normaliseNationalId(undefined)).toBeNull();
    expect(normaliseNationalId('')).toBeNull();
    expect(normaliseNationalId('none')).toBeNull();
  });

  it('keeps a short id rather than discarding it', () => {
    // Normalising is not validating. A thirteen-digit id is very likely a
    // transcription error the operator must fix by looking at the card — but
    // it is still the only identifier that row has.
    expect(normaliseNationalId('2900101123456')).toBe('2900101123456');
  });
});

describe('looksLikeNationalId', () => {
  it('accepts exactly fourteen digits, however they are punctuated', () => {
    expect(looksLikeNationalId('29001011234567')).toBe(true);
    expect(looksLikeNationalId('290-0101-1234567')).toBe(true);
    expect(looksLikeNationalId('٢٩٠٠١٠١١٢٣٤٥٦٧')).toBe(true);
  });

  it('rejects anything that is not fourteen digits', () => {
    expect(looksLikeNationalId('2900101123456')).toBe(false); // 13
    expect(looksLikeNationalId('290010112345678')).toBe(false); // 15
    expect(looksLikeNationalId('')).toBe(false);
    expect(looksLikeNationalId(null)).toBe(false);
    expect(looksLikeNationalId(undefined)).toBe(false);
  });

  it('checks length only, and deliberately not the embedded checksum', () => {
    // The checksum and the embedded birth date are real, but a file that fails
    // a checksum is almost always a transcription error a human must resolve
    // against the physical card — not a row software should silently reject.
    // This id is structurally impossible (month 99) and still passes.
    expect(looksLikeNationalId('29999011234567')).toBe(true);
  });
});

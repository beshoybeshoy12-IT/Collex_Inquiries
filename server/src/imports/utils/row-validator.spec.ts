import { Priority } from '@prisma/client';
import {
  isBlankRow,
  neutraliseFormula,
  parseExcelDate,
  validateRow,
  ValidationContext,
} from './row-validator';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Import row validation.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The import pipeline is the primary data-entry path: a file of a few
 *  thousand rows becomes a few thousand real investigations that real people
 *  drive to real addresses. Two failure modes matter, and they pull in
 *  opposite directions.
 *
 *  REFUSING TOO MUCH makes the tool hated. A row rejected over a national id
 *  with thirteen digits is a case that never gets worked, and the operator's
 *  response is to stop using the importer.
 *
 *  ACCEPTING TOO MUCH is worse but quieter. A row with no product silently
 *  defaulting to *some* product routes work to the wrong client and bills the
 *  wrong account, and nobody finds out for a month.
 *
 *  So the error/warning split is not a stylistic choice, and these tests pin
 *  which side of the line each rule sits on. A change that flips one of them
 *  should have to edit a test that says, in words, why it was there.
 */

const EMPTY_LOOKUPS = () => ({
  products: new Map<string, string>(),
  investigationTypes: new Map<string, string>(),
  governorates: new Map<string, string>(),
  cities: new Map<string, string>(),
  districts: new Map<string, string>(),
});

const LOOKUPS = () => {
  const lookups = EMPTY_LOOKUPS();
  lookups.products.set('cards', 'product-cards');
  lookups.products.set('بطاقات', 'product-cards');
  lookups.investigationTypes.set('home visit', 'type-home');
  lookups.investigationTypes.set('زيارة منزلية', 'type-home');
  lookups.governorates.set('cairo', 'gov-cairo');
  lookups.cities.set('nasr city', 'city-nasr');
  lookups.districts.set('zone 7', 'district-7');
  return lookups;
};

/** A mapping that covers everything these tests touch. */
const MAPPING = {
  fullName: 'Customer Name',
  nationalId: 'National ID',
  mobile: 'Mobile',
  residenceAddress: 'Address',
  governorate: 'Governorate',
  city: 'City',
  product: 'Product',
  investigationType: 'Type',
  priority: 'Priority',
  dueDate: 'Due Date',
  notes: 'Notes',
};

const context = (
  overrides: Partial<ValidationContext> = {},
): ValidationContext => ({
  mapping: MAPPING,
  lookups: LOOKUPS(),
  ...overrides,
});

/** A row that passes cleanly, as the baseline every test varies from. */
const goodRow = (overrides: Record<string, unknown> = {}) => ({
  'Customer Name': 'محمد أحمد إبراهيم',
  'National ID': '29001011234567',
  Mobile: '01001234567',
  Address: '12 Sharia Ramses',
  Product: 'Cards',
  Type: 'Home Visit',
  ...overrides,
});

const errorFields = (result: { errors: { field: string }[] }) =>
  result.errors.map((e) => e.field).sort();
const warningFields = (result: { warnings: { field: string }[] }) =>
  result.warnings.map((w) => w.field).sort();

describe('parseExcelDate', () => {
  it('passes a real Date through', () => {
    const date = new Date(2026, 4, 17);
    expect(parseExcelDate(date)).toEqual(date);
  });

  it('rejects an invalid Date object rather than propagating NaN', () => {
    expect(parseExcelDate(new Date('nonsense'))).toBeNull();
  });

  it('reads an Excel serial number', () => {
    // 45000 is 2023-03-15 on Excel's 1899-12-30 epoch.
    const parsed = parseExcelDate(45000);
    expect(parsed?.getUTCFullYear()).toBe(2023);
    expect(parsed?.getUTCMonth()).toBe(2);
    expect(parsed?.getUTCDate()).toBe(15);
  });

  it('refuses small numbers, which are quantities and not dates', () => {
    // An unformatted "5" in a date column is an amount somebody put in the
    // wrong place, not the 5th of January 1900. Turning it into a date would
    // give the case a deadline 126 years in the past and breach it instantly.
    expect(parseExcelDate(5)).toBeNull();
    expect(parseExcelDate(999)).toBeNull();
    expect(parseExcelDate(90000)).toBeNull();
  });

  it('reads dd/mm/yyyy as day-first, which is the local convention', () => {
    // The whole reason this function exists. `new Date('03/04/2026')` is
    // 3 April in some runtimes and 4 March in others; a deadline that moves by
    // a month depending on the Node build is not acceptable.
    const parsed = parseExcelDate('03/04/2026');
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(3); // April
    expect(parsed?.getDate()).toBe(3);
  });

  it.each(['17/05/2026', '17-05-2026', '17.05.2026', '7/5/2026'])(
    'accepts %s as a day-first date',
    (text) => {
      const parsed = parseExcelDate(text);
      expect(parsed?.getMonth()).toBe(4); // May
      expect(parsed?.getFullYear()).toBe(2026);
    },
  );

  it('reads an ISO date as ISO', () => {
    const parsed = parseExcelDate('2026-05-17');
    expect(parsed?.getUTCFullYear()).toBe(2026);
    expect(parsed?.getUTCMonth()).toBe(4);
    expect(parsed?.getUTCDate()).toBe(17);
  });

  it('returns null for blanks and unparseable text', () => {
    expect(parseExcelDate(null)).toBeNull();
    expect(parseExcelDate(undefined)).toBeNull();
    expect(parseExcelDate('')).toBeNull();
    expect(parseExcelDate('   ')).toBeNull();
    expect(parseExcelDate('not a date')).toBeNull();
  });
});

describe('neutraliseFormula', () => {
  it.each([
    [`=cmd|'/c calc'!A1`, true],
    ['=SUM(A1:A9)', true],
    ['+1234', true],
    ['-500', true],
    ['@import', true],
    ['\tHELLO', true],
  ])('prefixes %s so a spreadsheet treats it as text', (value, expected) => {
    // A name field re-exported to Excel and opened by a colleague is a code
    // execution path if the cell still starts with `=`. The value is kept —
    // it may be a legitimate negative number — but disarmed.
    expect(neutraliseFormula(value).startsWith("'")).toBe(expected);
    expect(neutraliseFormula(value)).toContain(value);
  });

  it.each(['Ahmed Hassan', 'محمد', '01001234567', '12 Sharia Ramses', ''])(
    'leaves %s alone',
    (value) => {
      expect(neutraliseFormula(value)).toBe(value);
    },
  );
});

describe('validateRow', () => {
  describe('the happy path', () => {
    it('accepts a complete row and resolves its lookups to ids', () => {
      const result = validateRow(goodRow(), context());
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(result.value.fullName).toBe('محمد أحمد إبراهيم');
      expect(result.value.productId).toBe('product-cards');
      expect(result.value.investigationTypeId).toBe('type-home');
    });

    it('matches lookups case-insensitively and in Arabic', () => {
      const result = validateRow(
        goodRow({ Product: 'بطاقات', Type: 'زيارة منزلية' }),
        context(),
      );
      expect(result.valid).toBe(true);
      expect(result.value.productId).toBe('product-cards');
      expect(result.value.investigationTypeId).toBe('type-home');
    });

    it('collapses whitespace instead of storing a ragged name', () => {
      const result = validateRow(
        goodRow({ 'Customer Name': '  Ahmed   Hassan  ' }),
        context(),
      );
      expect(result.value.fullName).toBe('Ahmed Hassan');
    });

    it.each(['-', '--', 'N/A', 'na', 'null', 'NONE', '#N/A'])(
      'treats %s as an empty cell rather than as a value',
      (placeholder) => {
        // These are what a human types when there is nothing to type. Storing
        // "N/A" as a customer's address sends somebody to a street called N/A.
        const result = validateRow(
          goodRow({ Address: placeholder }),
          context(),
        );
        expect(result.value.residenceAddress).toBeUndefined();
      },
    );
  });

  describe('what blocks the row', () => {
    it('refuses a row with no customer name', () => {
      // Without a name the resulting case is unusable — there is nobody to
      // investigate. This is the one identity field that has to be there.
      const result = validateRow(goodRow({ 'Customer Name': '' }), context());
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('fullName');
    });

    it('refuses a row whose product is not in the catalogue', () => {
      // An unknown product must never fall back to "some product". It decides
      // which client is billed and which SLA applies.
      const result = validateRow(goodRow({ Product: 'Mortgages' }), context());
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('product');
      expect(
        result.errors.find((e) => e.field === 'product')?.reasonEn,
      ).toContain('Mortgages');
    });

    it('refuses a row whose investigation type is not in the catalogue', () => {
      const result = validateRow(goodRow({ Type: 'Séance' }), context());
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('investigationType');
    });

    it('refuses an unparseable date rather than guessing one', () => {
      // A wrong deadline is worse than a missing one: it silently drives the
      // SLA colour and the escalation engine.
      const result = validateRow(
        goodRow({ 'Due Date': 'next tuesday-ish' }),
        context(),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('dueDate');
    });

    it('names the source column, not the internal field key', () => {
      // The person fixing this is looking at their own spreadsheet, where
      // "Customer Name" means something and "fullName" does not.
      const result = validateRow(goodRow({ 'Customer Name': '' }), context());
      const problem = result.errors.find((e) => e.field === 'fullName');
      expect(problem?.column).toBe('Customer Name');
    });

    it('reports every problem in the row, not just the first', () => {
      // A validate-first importer exists so the operator can fix the file in
      // one pass. Stopping at the first error turns that into N passes.
      const result = validateRow(
        {
          'Customer Name': '',
          Product: 'Nope',
          Type: 'Nope',
          'Due Date': 'rubbish',
        },
        context(),
      );
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
      expect(errorFields(result)).toEqual(
        expect.arrayContaining([
          'fullName',
          'product',
          'investigationType',
          'dueDate',
        ]),
      );
    });

    it('gives every problem both an Arabic and an English reason', () => {
      const result = validateRow({ 'Customer Name': '' }, context());
      for (const problem of [...result.errors, ...result.warnings]) {
        expect(problem.reasonAr.length).toBeGreaterThan(0);
        expect(problem.reasonEn.length).toBeGreaterThan(0);
        expect(problem.reasonAr).not.toBe(problem.reasonEn);
      }
    });
  });

  describe('what only warns', () => {
    it('warns about a short national id but keeps the row', () => {
      // Usually a transcription error. Refusing the row would stop a real
      // investigation over one digit that the investigator can confirm at the
      // door.
      const result = validateRow(
        goodRow({ 'National ID': '2900101123' }),
        context(),
      );
      expect(result.valid).toBe(true);
      expect(warningFields(result)).toContain('nationalId');
      expect(result.value.nationalId).toBe('2900101123');
    });

    it('warns about a malformed phone but keeps the row', () => {
      // A bad phone still leaves a visitable address.
      const result = validateRow(
        goodRow({ Mobile: 'call the office' }),
        context(),
      );
      expect(result.valid).toBe(true);
      expect(warningFields(result)).toContain('mobile');
    });

    it('accepts a phone written any of the ways a bank file writes it', () => {
      for (const written of [
        '01001234567',
        '+201001234567',
        '0020 100 123 4567',
        '0100-123-4567',
      ]) {
        const result = validateRow(goodRow({ Mobile: written }), context());
        expect(warningFields(result)).not.toContain('mobile');
        // The original string is preserved; only a derived form is compared on.
        expect(result.value.mobile).toBe(written);
      }
    });

    it('warns about an unknown geography value instead of blocking', () => {
      // Governorate/city/district are useful for routing, not required to run
      // the case — the address is what the investigator actually uses.
      const result = validateRow(
        goodRow({ Governorate: 'Atlantis', City: 'Nowhere' }),
        context(),
      );
      expect(result.valid).toBe(true);
      expect(warningFields(result)).toEqual(
        expect.arrayContaining(['governorate', 'city']),
      );
    });

    it('warns about an unknown priority and leaves it to the default', () => {
      const result = validateRow(
        goodRow({ Priority: 'super duper urgent' }),
        context(),
      );
      expect(result.valid).toBe(true);
      expect(warningFields(result)).toContain('priority');
      expect(result.value.priority).toBeUndefined();
    });

    it.each([
      ['urgent', Priority.URGENT],
      ['Critical', Priority.URGENT],
      ['high', Priority.HIGH],
      ['normal', Priority.NORMAL],
      ['medium', Priority.NORMAL],
      ['low', Priority.LOW],
      ['عاجل', Priority.URGENT],
      ['عالية', Priority.HIGH],
      ['عادي', Priority.NORMAL],
      ['منخفض', Priority.LOW],
    ])('reads priority %s as %s', (written, expected) => {
      const result = validateRow(goodRow({ Priority: written }), context());
      expect(result.value.priority).toBe(expected);
      expect(warningFields(result)).not.toContain('priority');
    });
  });

  describe('batch defaults', () => {
    it('fills product and type from the batch when the sheet has no columns', () => {
      // The common case: a file from one bank for one product, with no product
      // column in it at all.
      const result = validateRow(
        { Name: 'Ahmed Hassan' },
        context({
          mapping: { fullName: 'Name' },
          defaults: {
            productId: 'product-cards',
            investigationTypeId: 'type-home',
          },
        }),
      );
      expect(result.valid).toBe(true);
      expect(result.value.productId).toBe('product-cards');
      expect(result.value.investigationTypeId).toBe('type-home');
    });

    it('lets a mapped column win over the batch default', () => {
      const lookups = LOOKUPS();
      lookups.products.set('loans', 'product-loans');
      const result = validateRow(
        goodRow({ Product: 'Loans' }),
        context({ lookups, defaults: { productId: 'product-cards' } }),
      );
      expect(result.value.productId).toBe('product-loans');
    });

    it('still refuses when neither a column nor a default supplies a product', () => {
      const result = validateRow(
        { Name: 'Ahmed Hassan' },
        context({ mapping: { fullName: 'Name' } }),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toEqual(
        expect.arrayContaining(['product', 'investigationType']),
      );
      // The message points at the fix, which is on the batch and not the row.
      expect(
        result.errors.find((e) => e.field === 'product')?.reasonEn,
      ).toContain('batch default');
    });

    it('applies a batch due date when the sheet carries none', () => {
      const dueAt = new Date(2026, 5, 30);
      const result = validateRow(
        goodRow(),
        context({
          defaults: { dueAt, productId: 'x', investigationTypeId: 'y' },
        }),
      );
      expect(result.value.dueDate).toEqual(dueAt);
    });
  });

  describe('product-specific required fields', () => {
    it('enforces the extra fields a product insists on', () => {
      // `Product.requiredFields` is a per-tenant, per-product configuration
      // row — not a hard-coded rule. A product that cannot be investigated
      // without a workplace says so in the database.
      const result = validateRow(
        goodRow(),
        context({ extraRequired: ['workplaceName'] }),
      );
      expect(result.valid).toBe(false);
      expect(errorFields(result)).toContain('workplaceName');
    });

    it('is satisfied when the extra field is present', () => {
      const result = validateRow(
        goodRow({ Employer: 'Banque Misr' }),
        context({
          mapping: { ...MAPPING, workplaceName: 'Employer' },
          extraRequired: ['workplaceName'],
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('checks the resolved id for a lookup-typed extra requirement', () => {
      // `governorate` resolves into `governorateId`; a requiredness check that
      // looked at `value.governorate` would fail on every valid row.
      const ok = validateRow(
        goodRow({ Governorate: 'Cairo' }),
        context({ extraRequired: ['governorate'] }),
      );
      expect(ok.valid).toBe(true);

      const missing = validateRow(
        goodRow(),
        context({ extraRequired: ['governorate'] }),
      );
      expect(missing.valid).toBe(false);
      expect(errorFields(missing)).toContain('governorate');
    });
  });

  describe('injection defence', () => {
    it('disarms a formula that arrives in a name cell', () => {
      const result = validateRow(
        goodRow({ 'Customer Name': `=cmd|'/c calc'!A1` }),
        context(),
      );
      expect(String(result.value.fullName).startsWith("'")).toBe(true);
    });

    it('disarms a formula in a free-text notes cell', () => {
      const result = validateRow(
        goodRow({ Notes: '@SUM(1+9)*cmd' }),
        context({ mapping: { ...MAPPING, notes: 'Notes' } }),
      );
      expect(String(result.value.notes).startsWith("'")).toBe(true);
    });
  });
});

describe('isBlankRow', () => {
  it('is true for the trailing empties every spreadsheet ends with', () => {
    expect(isBlankRow({}, MAPPING)).toBe(true);
    expect(isBlankRow({ 'Customer Name': '', Mobile: '   ' }, MAPPING)).toBe(
      true,
    );
  });

  it('is true when every mapped cell holds only a placeholder', () => {
    expect(isBlankRow({ 'Customer Name': '-', Mobile: 'N/A' }, MAPPING)).toBe(
      true,
    );
  });

  it('is false as soon as one mapped cell has content', () => {
    expect(isBlankRow({ 'Customer Name': 'Ahmed' }, MAPPING)).toBe(false);
  });

  it('ignores content in columns that are not mapped', () => {
    // An unmapped column full of the bank's own reference numbers must not
    // keep thousands of blank trailing rows alive.
    expect(isBlankRow({ 'Internal Ref': 'XYZ-1' }, MAPPING)).toBe(true);
  });
});

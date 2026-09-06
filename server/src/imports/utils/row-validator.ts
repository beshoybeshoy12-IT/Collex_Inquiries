import { Priority } from '@prisma/client';
import { FIELD_BY_KEY, ImportField, IMPORT_FIELDS } from './field-catalog';
import {
  looksLikeNationalId,
  looksLikePhone,
  normaliseNationalId,
} from '../../common/utils/phone.util';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Row validation.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Every problem is reported with the row number, the *source column header*
 *  and a bilingual reason — because the person fixing it is looking at the
 *  original spreadsheet, where "row 412, column 'Mobile'" means something and
 *  "mappedData.mobile failed validation" does not.
 *
 *  ERRORS BLOCK, WARNINGS DO NOT. A missing customer name is an error: the
 *  resulting case would be unusable. A national id that is not fourteen digits
 *  is a warning: it is very often a genuine transcription problem, but
 *  refusing the row would stop a real investigation over a digit, and the
 *  investigator can confirm the number at the door. Getting this line wrong in
 *  either direction is what makes an import tool hated.
 */

export interface CellProblem {
  /** The system field key. */
  field: string;
  /** The header as it appears in the user's file. */
  column: string;
  reasonAr: string;
  reasonEn: string;
}

export interface RowValidationResult {
  valid: boolean;
  errors: CellProblem[];
  warnings: CellProblem[];
  /** Cleaned values, ready to become records. */
  value: Record<string, unknown>;
}

export interface LookupTables {
  /** Lowercased code or name → id. */
  products: Map<string, string>;
  investigationTypes: Map<string, string>;
  governorates: Map<string, string>;
  cities: Map<string, string>;
  districts: Map<string, string>;
}

export interface ValidationContext {
  /** `{ fieldKey: sourceHeader }` — the confirmed mapping. */
  mapping: Record<string, string>;
  lookups: LookupTables;
  /** Applied when the sheet has no column for a field. */
  defaults?: {
    productId?: string;
    investigationTypeId?: string;
    priority?: Priority;
    dueAt?: Date;
  };
  /** Extra field keys this product insists on, from `Product.requiredFields`. */
  extraRequired?: string[];
}

const PRIORITY_ALIASES: Record<string, Priority> = {
  low: Priority.LOW,
  normal: Priority.NORMAL,
  medium: Priority.NORMAL,
  standard: Priority.NORMAL,
  high: Priority.HIGH,
  urgent: Priority.URGENT,
  critical: Priority.URGENT,
  منخفض: Priority.LOW,
  عادي: Priority.NORMAL,
  عادية: Priority.NORMAL,
  متوسط: Priority.NORMAL,
  مرتفع: Priority.HIGH,
  عالي: Priority.HIGH,
  عالية: Priority.HIGH,
  عاجل: Priority.URGENT,
  عاجلة: Priority.URGENT,
  حرج: Priority.URGENT,
};

/**
 * Coerce a spreadsheet cell to text.
 *
 * A cell is `unknown` because a parser can hand back a string, a number, a
 * boolean, a Date, or — for a rich-text or error cell — an object. A blanket
 * `String(raw)` turns that last case into the literal text
 * "[object Object]", which then passes every emptiness check and is stored as
 * somebody's name. An object cell carries nothing this importer can use, so it
 * reads as empty.
 */
function cellText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'object') return '';
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(raw);
}

/**
 * Excel dates arrive three ways: a real Date (when the cell was formatted as a
 * date), a serial number (when it was not), or a string a human typed. All
 * three have to work, because all three turn up in the same file.
 */
export function parseExcelDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;

  if (typeof raw === 'number') {
    // Excel's epoch is 1899-12-30 (its deliberate 1900 leap-year bug included).
    // Values under 1000 are far more likely to be a quantity than a date in
    // 1902, so they are refused rather than silently turned into one.
    if (raw < 1000 || raw > 80000) return null;
    const parsed = new Date(Math.round((raw - 25569) * 86400 * 1000));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const text = cellText(raw).trim();
  if (!text) return null;

  // dd/mm/yyyy is the Egyptian convention and is what these files use;
  // Date.parse would read 03/04/2026 as 3 April in some runtimes and 4 March
  // in others, so the unambiguous forms are matched explicitly first.
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text);
  if (dmy) {
    const [, d, m, y] = dmy;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Trim, collapse whitespace, and treat Excel's empty markers as empty. */
function cleanString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = cellText(raw).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (
    ['-', '--', 'n/a', 'na', 'null', 'none', '#n/a'].includes(
      text.toLowerCase(),
    )
  ) {
    return null;
  }
  return text;
}

/**
 * Formula and command injection defence.
 *
 * A cell beginning with `=`, `+`, `-` or `@` is executed as a formula when the
 * exported file is reopened in Excel — so a customer name of
 * `=cmd|'/c calc'!A1` becomes code execution on the machine of whoever opens
 * the export. The value is kept (it may be a legitimate negative number in a
 * numeric column) but prefixed so a spreadsheet treats it as text.
 */
export function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function problem(
  field: ImportField | undefined,
  fieldKey: string,
  column: string,
  reasonAr: string,
  reasonEn: string,
): CellProblem {
  return {
    field: fieldKey,
    column: column || field?.labelEn || fieldKey,
    reasonAr,
    reasonEn,
  };
}

/** Validate and clean one mapped row. */
export function validateRow(
  raw: Record<string, unknown>,
  context: ValidationContext,
): RowValidationResult {
  const errors: CellProblem[] = [];
  const warnings: CellProblem[] = [];
  const value: Record<string, unknown> = {};

  for (const field of IMPORT_FIELDS) {
    const column = context.mapping[field.key];
    const cell = column ? raw[column] : undefined;
    const text = cleanString(cell);

    if (text === null) {
      // Nothing in the cell. Requiredness is checked after defaults are
      // applied, below, so a missing column that has a default is not an error.
      continue;
    }

    switch (field.type) {
      case 'string': {
        const cleaned = neutraliseFormula(text);
        if (field.maxLength && cleaned.length > field.maxLength) {
          errors.push(
            problem(
              field,
              field.key,
              column,
              `القيمة أطول من ${field.maxLength} حرف`,
              `Value is longer than ${field.maxLength} characters`,
            ),
          );
          break;
        }
        value[field.key] = cleaned;
        break;
      }

      case 'phone': {
        const digits = text.replace(/\D/g, '');
        if (!looksLikePhone(text)) {
          // A warning, not an error: a malformed phone still leaves a visitable
          // address, and refusing the row would lose the whole case over it.
          warnings.push(
            problem(
              field,
              field.key,
              column,
              'رقم الهاتف غير صالح',
              'Phone number does not look valid',
            ),
          );
        }
        value[field.key] = digits.length > 0 ? text : null;
        break;
      }

      case 'nationalId': {
        const normalised = normaliseNationalId(text);
        if (!looksLikeNationalId(text)) {
          warnings.push(
            problem(
              field,
              field.key,
              column,
              'الرقم القومي يجب أن يكون 14 رقمًا',
              'National id should be 14 digits',
            ),
          );
        }
        value[field.key] = normalised;
        break;
      }

      case 'number': {
        const parsed = Number(text.replace(/,/g, ''));
        if (Number.isNaN(parsed)) {
          errors.push(
            problem(
              field,
              field.key,
              column,
              'القيمة ليست رقمًا',
              'Value is not a number',
            ),
          );
          break;
        }
        value[field.key] = parsed;
        break;
      }

      case 'date': {
        const parsed = parseExcelDate(cell);
        if (!parsed) {
          errors.push(
            problem(
              field,
              field.key,
              column,
              'تاريخ غير صالح، استخدم dd/mm/yyyy',
              'Invalid date; use dd/mm/yyyy',
            ),
          );
          break;
        }
        value[field.key] = parsed;
        break;
      }

      case 'enum': {
        if (field.key === 'priority') {
          const resolved = PRIORITY_ALIASES[text.toLowerCase()];
          if (!resolved) {
            warnings.push(
              problem(
                field,
                field.key,
                column,
                'أولوية غير معروفة، سيتم استخدام الأولوية الافتراضية',
                'Unrecognised priority; the default will be used',
              ),
            );
            break;
          }
          value[field.key] = resolved;
        }
        break;
      }

      case 'lookup': {
        const table = lookupTableFor(field, context.lookups);
        const resolved = table?.get(text.toLowerCase());

        if (!resolved) {
          const severity =
            field.key === 'product' || field.key === 'investigationType'
              ? errors
              : warnings;
          severity.push(
            problem(
              field,
              field.key,
              column,
              `القيمة "${text}" غير موجودة في ${field.labelAr}`,
              `"${text}" was not found in ${field.labelEn}`,
            ),
          );
          break;
        }
        value[`${field.key}Id`] = resolved;
        break;
      }
    }
  }

  // Defaults fill in what the sheet did not carry. Applied before the required
  // check, so a file with no Product column imports fine when the batch names
  // a default product — which is the common case.
  if (!value.productId && context.defaults?.productId) {
    value.productId = context.defaults.productId;
  }
  if (!value.investigationTypeId && context.defaults?.investigationTypeId) {
    value.investigationTypeId = context.defaults.investigationTypeId;
  }
  if (!value.priority && context.defaults?.priority) {
    value.priority = context.defaults.priority;
  }
  if (!value.dueDate && context.defaults?.dueAt) {
    value.dueDate = context.defaults.dueAt;
  }

  for (const key of [
    ...IMPORT_FIELDS.filter((f) => f.required).map((f) => f.key),
    ...(context.extraRequired ?? []),
  ]) {
    const field = FIELD_BY_KEY.get(key);
    const isLookup = field?.type === 'lookup';
    const present = isLookup ? value[`${key}Id`] : value[key];

    if (present === undefined || present === null || present === '') {
      errors.push(
        problem(
          field,
          key,
          context.mapping[key],
          `${field?.labelAr ?? key} مطلوب`,
          `${field?.labelEn ?? key} is required`,
        ),
      );
    }
  }

  // A case needs both, whether from a column or a batch default. Reported once
  // rather than per row-with-no-column, because the fix is on the batch.
  if (!value.productId) {
    errors.push(
      problem(
        FIELD_BY_KEY.get('product'),
        'product',
        context.mapping.product,
        'المنتج مطلوب — حدد عمودًا أو منتجًا افتراضيًا للدفعة',
        'Product is required — map a column or set a batch default',
      ),
    );
  }
  if (!value.investigationTypeId) {
    errors.push(
      problem(
        FIELD_BY_KEY.get('investigationType'),
        'investigationType',
        context.mapping.investigationType,
        'نوع الاستعلام مطلوب — حدد عمودًا أو نوعًا افتراضيًا للدفعة',
        'Investigation type is required — map a column or set a batch default',
      ),
    );
  }

  return { valid: errors.length === 0, errors, warnings, value };
}

function lookupTableFor(
  field: ImportField,
  lookups: LookupTables,
): Map<string, string> | undefined {
  switch (field.lookup) {
    case 'product':
      return lookups.products;
    case 'investigationType':
      return lookups.investigationTypes;
    case 'governorate':
      return lookups.governorates;
    case 'city':
      return lookups.cities;
    case 'district':
      return lookups.districts;
    default:
      return undefined;
  }
}

/** True when every mapped cell in the row is empty — a trailing blank row. */
export function isBlankRow(
  raw: Record<string, unknown>,
  mapping: Record<string, string>,
): boolean {
  return Object.values(mapping).every(
    (column) => cleanString(raw[column]) === null,
  );
}

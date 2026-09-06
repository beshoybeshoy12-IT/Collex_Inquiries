/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The importable field catalogue, and header auto-detection.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Two jobs:
 *
 *  1. Declare every field an Excel column can map to, with its type, whether it
 *     is required, and bilingual labels. The mapping screen renders straight
 *     from this, so a new importable field needs an entry here and nothing
 *     else.
 *
 *  2. Guess the mapping. Each field carries a list of header aliases — Arabic,
 *     English, and the combined `"Full Name | اسم العميل"` forms that banks
 *     actually ship — so most files map themselves and the coordinator only
 *     corrects what the guess got wrong.
 *
 *  Collex System V1 learned this the expensive way: per-bank parsing code meant
 *  a new client was a release. Aliases mean a new client is usually a row in
 *  this file, and often nothing at all.
 *
 *  THE GUESS IS ONLY EVER A DEFAULT. Nothing here is authoritative — the
 *  coordinator confirms the mapping before a single row is imported, and a
 *  saved `ImportMappingTemplate` overrides the guess entirely for a client
 *  whose headers are stable.
 */

export type FieldType =
  'string' | 'number' | 'date' | 'phone' | 'nationalId' | 'enum' | 'lookup';

export interface ImportField {
  /** The key written into `ImportRow.mappedData`. */
  key: string;
  labelAr: string;
  labelEn: string;
  type: FieldType;
  required: boolean;
  /** Which entity this column belongs to once the row is turned into records. */
  target: 'customer' | 'investigation';
  maxLength?: number;
  /** Header spellings seen in the wild. Matched case- and space-insensitively. */
  aliases: string[];
  /** For `lookup` fields: which catalogue the value is resolved against. */
  lookup?:
    'product' | 'investigationType' | 'governorate' | 'city' | 'district';
  hintAr?: string;
  hintEn?: string;
}

export const IMPORT_FIELDS: ImportField[] = [
  // ── Identity ─────────────────────────────────────────────────────────────
  {
    key: 'fullName',
    labelAr: 'اسم العميل',
    labelEn: 'Customer Name',
    type: 'string',
    required: true,
    target: 'customer',
    maxLength: 200,
    aliases: [
      'customer name',
      'full name',
      'client name',
      'name',
      'اسم العميل',
      'الاسم',
      'اسم العميل الرباعي',
      'الاسم بالكامل',
      'full name | اسم العميل',
      'customer name | اسم العميل',
      'اسم العميل | customer name',
    ],
  },
  {
    key: 'nationalId',
    labelAr: 'الرقم القومي',
    labelEn: 'National ID',
    type: 'nationalId',
    required: false,
    target: 'customer',
    maxLength: 20,
    aliases: [
      'national id',
      'nid',
      'id number',
      'national number',
      'الرقم القومي',
      'رقم البطاقة',
      'رقم البطاقه',
      'الرقم القومى',
      'national id | الرقم القومي',
      'الرقم القومي | national id',
    ],
    hintAr: '14 رقمًا',
    hintEn: '14 digits',
  },
  {
    key: 'mobile',
    labelAr: 'رقم الموبايل',
    labelEn: 'Customer Phone',
    type: 'phone',
    required: false,
    target: 'customer',
    maxLength: 20,
    aliases: [
      'mobile',
      'phone',
      'customer phone',
      'mobile number',
      'primary phone',
      'phone 1',
      'contact number',
      'رقم الموبايل',
      'الموبايل',
      'رقم الهاتف',
      'تليفون العميل',
      'تليفونات العميل',
      'mobile | رقم الموبايل',
      'رقم الهاتف | phone',
    ],
  },
  {
    key: 'altMobile',
    labelAr: 'رقم موبايل بديل',
    labelEn: 'Alternate Phone',
    type: 'phone',
    required: false,
    target: 'customer',
    maxLength: 20,
    aliases: [
      'alternate phone',
      'alternative phone',
      'phone 2',
      'second phone',
      'mobile 2',
      'رقم بديل',
      'رقم الهاتف البديل',
      'موبايل 2',
    ],
  },
  {
    key: 'homePhone',
    labelAr: 'تليفون المنزل',
    labelEn: 'Home Phone',
    type: 'phone',
    required: false,
    target: 'customer',
    maxLength: 20,
    aliases: [
      'home phone',
      'landline',
      'house phone',
      'تليفون المنزل',
      'التليفون الأرضي',
      'الهاتف المنزلي',
    ],
  },

  // ── Residence ────────────────────────────────────────────────────────────
  {
    key: 'residenceAddress',
    labelAr: 'عنوان السكن',
    labelEn: 'Residence Address',
    type: 'string',
    required: false,
    target: 'customer',
    maxLength: 500,
    aliases: [
      'residence',
      'residence address',
      'home address',
      'address',
      'customer address',
      'عنوان السكن',
      'العنوان',
      'عنوان المنزل',
      'محل الإقامة',
      'residence address | عنوان السكن',
    ],
  },
  {
    key: 'governorate',
    labelAr: 'المحافظة',
    labelEn: 'Governorate',
    type: 'lookup',
    required: false,
    target: 'investigation',
    lookup: 'governorate',
    aliases: ['governorate', 'province', 'state', 'المحافظة', 'محافظة'],
  },
  {
    key: 'city',
    labelAr: 'المدينة',
    labelEn: 'City',
    type: 'lookup',
    required: false,
    target: 'investigation',
    lookup: 'city',
    aliases: ['city', 'town', 'المدينة', 'مدينة', 'المركز'],
  },
  {
    key: 'district',
    labelAr: 'الحي',
    labelEn: 'District',
    type: 'lookup',
    required: false,
    target: 'investigation',
    lookup: 'district',
    aliases: ['district', 'area', 'zone', 'الحي', 'المنطقة', 'القسم'],
  },

  // ── Workplace ────────────────────────────────────────────────────────────
  {
    key: 'workplaceName',
    labelAr: 'جهة العمل',
    labelEn: 'Workplace Name',
    type: 'string',
    required: false,
    target: 'customer',
    maxLength: 200,
    aliases: [
      'workplace',
      'workplace name',
      'employer',
      'company name',
      'company',
      'جهة العمل',
      'اسم الشركة',
      'مكان العمل',
      'employer | جهة العمل',
    ],
  },
  {
    key: 'workplaceAddress',
    labelAr: 'عنوان العمل',
    labelEn: 'Workplace Address',
    type: 'string',
    required: false,
    target: 'customer',
    maxLength: 500,
    aliases: [
      'workplace address',
      'work address',
      'employer address',
      'business address',
      'عنوان العمل',
      'عنوان جهة العمل',
    ],
  },
  {
    key: 'workplacePhone',
    labelAr: 'تليفون العمل',
    labelEn: 'Workplace Phone',
    type: 'phone',
    required: false,
    target: 'customer',
    maxLength: 20,
    aliases: [
      'workplace phone',
      'work phone',
      'office phone',
      'employer phone',
      'تليفون العمل',
      'تليفونات العمل',
      'هاتف العمل',
    ],
  },
  {
    key: 'jobTitle',
    labelAr: 'المسمى الوظيفي',
    labelEn: 'Job Title',
    type: 'string',
    required: false,
    target: 'customer',
    maxLength: 120,
    aliases: [
      'job title',
      'position',
      'occupation',
      'designation',
      'المسمى الوظيفي',
      'الوظيفة',
      'المهنة',
    ],
  },

  // ── The request ──────────────────────────────────────────────────────────
  {
    key: 'applicationNumber',
    labelAr: 'رقم الطلب',
    labelEn: 'Application Number',
    type: 'string',
    required: false,
    target: 'investigation',
    maxLength: 60,
    aliases: [
      'application number',
      'application no',
      'app number',
      'app no',
      'reference',
      'reference number',
      'request number',
      'file number',
      'رقم الطلب',
      'رقم الملف',
      'الرقم المرجعي',
      'application number | رقم الطلب',
    ],
  },
  {
    key: 'product',
    labelAr: 'المنتج',
    labelEn: 'Product',
    type: 'lookup',
    required: false,
    target: 'investigation',
    lookup: 'product',
    aliases: [
      'product',
      'product type',
      'product name',
      'loan type',
      'facility',
      'المنتج',
      'نوع المنتج',
      'نوع القرض',
      'التسهيل',
    ],
    hintAr: 'يُطابق كود أو اسم المنتج',
    hintEn: 'Matched against the product code or name',
  },
  {
    key: 'investigationType',
    labelAr: 'نوع الاستعلام',
    labelEn: 'Investigation Type',
    type: 'lookup',
    required: false,
    target: 'investigation',
    lookup: 'investigationType',
    aliases: [
      'investigation type',
      'inquiry type',
      'verification type',
      'visit type',
      'type',
      'نوع الاستعلام',
      'نوع التحقيق',
      'نوع الزيارة',
      'نوع المعاينة',
    ],
  },
  {
    key: 'priority',
    labelAr: 'الأولوية',
    labelEn: 'Priority',
    type: 'enum',
    required: false,
    target: 'investigation',
    aliases: ['priority', 'urgency', 'الأولوية', 'درجة الأهمية', 'الاستعجال'],
    hintAr: 'LOW / NORMAL / HIGH / URGENT',
    hintEn: 'LOW / NORMAL / HIGH / URGENT',
  },
  {
    key: 'dueDate',
    labelAr: 'تاريخ الاستحقاق',
    labelEn: 'Due Date',
    type: 'date',
    required: false,
    target: 'investigation',
    aliases: [
      'due date',
      'deadline',
      'target date',
      'required by',
      'تاريخ الاستحقاق',
      'التاريخ المطلوب',
      'الموعد النهائي',
    ],
  },
  {
    key: 'notes',
    labelAr: 'ملاحظات',
    labelEn: 'Notes',
    type: 'string',
    required: false,
    target: 'investigation',
    maxLength: 2000,
    aliases: ['notes', 'remarks', 'comments', 'ملاحظات', 'تعليقات', 'بيان'],
  },
];

export const FIELD_BY_KEY = new Map(IMPORT_FIELDS.map((f) => [f.key, f]));

export const REQUIRED_FIELD_KEYS = IMPORT_FIELDS.filter((f) => f.required).map(
  (f) => f.key,
);

/**
 * Normalise a header for comparison.
 *
 * Collapses whitespace, strips punctuation, folds Arabic orthographic variants
 * (أ إ آ → ا, ة → ه, ى → ي) and removes diacritics. Bank files spell the same
 * header three ways across three months, and none of those differences mean
 * anything.
 */
export function normaliseHeader(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '') // Arabic diacritics
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[_\-.:/\\()[\]{}#*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Alias → field key, built once. */
const ALIAS_INDEX = new Map<string, string>();
for (const field of IMPORT_FIELDS) {
  for (const alias of [
    field.key,
    field.labelAr,
    field.labelEn,
    ...field.aliases,
  ]) {
    ALIAS_INDEX.set(normaliseHeader(alias), field.key);
  }
}

/** Which field, if any, a header names. */
export function resolveHeaderField(header: string): string | null {
  const normalised = normaliseHeader(header);
  if (!normalised) return null;

  const exact = ALIAS_INDEX.get(normalised);
  if (exact) return exact;

  // A combined header — `"Full Name | اسم العميل"` — is split and each half
  // tried, which covers the bilingual columns without listing every pairing.
  if (normalised.includes('|')) {
    for (const part of normalised.split('|')) {
      const hit = ALIAS_INDEX.get(part.trim());
      if (hit) return hit;
    }
  }

  // Last resort: an alias contained in the header. Deliberately requires the
  // alias to be reasonably long, or "id" would match "national id", "app id"
  // and "city id" indiscriminately.
  for (const [alias, key] of ALIAS_INDEX) {
    if (alias.length >= 6 && normalised.includes(alias)) return key;
  }

  return null;
}

/**
 * Guess a whole sheet's mapping.
 *
 * Returns `{ fieldKey: header }`, plus the headers it could not place. A header
 * that matches a field already claimed by an earlier column is left unmapped
 * rather than overwriting it: the first column wins, and the coordinator
 * resolves the ambiguity on the mapping screen.
 */
export function suggestMapping(headers: string[]): {
  mapping: Record<string, string>;
  unmapped: string[];
  ambiguous: { header: string; field: string; takenBy: string }[];
} {
  const mapping: Record<string, string> = {};
  const unmapped: string[] = [];
  const ambiguous: { header: string; field: string; takenBy: string }[] = [];

  for (const header of headers) {
    if (!header?.trim()) continue;

    const field = resolveHeaderField(header);
    if (!field) {
      unmapped.push(header);
      continue;
    }

    if (mapping[field]) {
      ambiguous.push({ header, field, takenBy: mapping[field] });
      continue;
    }

    mapping[field] = header;
  }

  return { mapping, unmapped, ambiguous };
}

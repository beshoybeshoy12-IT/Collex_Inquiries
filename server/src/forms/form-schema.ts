import { BadRequestException } from '@nestjs/common';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  The dynamic form schema.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  A form is sections → fields, stored as JSON on `FormVersion.schema` and
 *  rendered by both the web preview and the future mobile client from that one
 *  definition. The types here are the contract between the builder, the
 *  renderer and the answer validator; if they disagree, the field the
 *  investigator was asked and the answer that was stored disagree too.
 *
 *  WHY JSON AND NOT TABLES. A field with options, validation rules and
 *  conditional logic is a tree, and normalising it means five joins to render
 *  one form and a migration every time a new field type appears. The trade is
 *  that the database cannot enforce the shape — so this file does, on publish,
 *  and refuses anything it cannot render.
 *
 *  CONDITIONAL LOGIC IS DECLARATIVE, DELIBERATELY. `visibleWhen` is data, not
 *  an expression to evaluate: a rule engine that takes arbitrary strings on a
 *  form built by a tenant administrator and evaluated on an investigator's
 *  handset is a code-execution surface with no upside.
 */

export type FormFieldType =
  | 'TEXT'
  | 'LONG_TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'TIME'
  | 'DATETIME'
  | 'DROPDOWN'
  | 'MULTI_SELECT'
  | 'RADIO'
  | 'CHECKBOX'
  | 'FILE'
  | 'PHOTO'
  | 'SIGNATURE'
  | 'GPS'
  | 'ADDRESS'
  | 'RATING'
  | 'TABLE'
  | 'REPEATER'
  | 'SECTION_NOTE';

export const FIELD_TYPES: FormFieldType[] = [
  'TEXT',
  'LONG_TEXT',
  'NUMBER',
  'DATE',
  'TIME',
  'DATETIME',
  'DROPDOWN',
  'MULTI_SELECT',
  'RADIO',
  'CHECKBOX',
  'FILE',
  'PHOTO',
  'SIGNATURE',
  'GPS',
  'ADDRESS',
  'RATING',
  'TABLE',
  'REPEATER',
  'SECTION_NOTE',
];

/** Types that carry a fixed option list. */
const OPTION_TYPES: FormFieldType[] = [
  'DROPDOWN',
  'MULTI_SELECT',
  'RADIO',
  'CHECKBOX',
];

/** Types whose answer is a media asset id rather than a scalar. */
export const MEDIA_TYPES: FormFieldType[] = ['FILE', 'PHOTO', 'SIGNATURE'];

/** Types that contain child fields. */
const CONTAINER_TYPES: FormFieldType[] = ['TABLE', 'REPEATER'];

export interface FormOption {
  /** Stable, language-independent. This is what gets stored as the answer. */
  value: string;
  labelAr: string;
  labelEn: string;
}

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  /** A named pattern, not a raw regex — see `NAMED_PATTERNS` below. */
  pattern?: keyof typeof NAMED_PATTERNS;
  minItems?: number;
  maxItems?: number;
}

/**
 * Named patterns rather than tenant-supplied regular expressions.
 *
 * A regex from a form builder is evaluated on an investigator's phone against
 * text they typed; a catastrophically backtracking one written by accident
 * freezes the app in the field. Named patterns cannot do that and cover
 * everything these forms actually need.
 */
export const NAMED_PATTERNS = {
  DIGITS: /^\d+$/,
  EGYPT_MOBILE: /^(\+?20)?1[0125]\d{8}$/,
  NATIONAL_ID: /^\d{14}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  ALPHANUMERIC: /^[a-zA-Z0-9؀-ۿ\s]+$/,
} as const;

/** One condition. `field` names a sibling field's key. */
export interface VisibilityCondition {
  field: string;
  operator:
    'EQUALS' | 'NOT_EQUALS' | 'IN' | 'NOT_IN' | 'IS_EMPTY' | 'IS_NOT_EMPTY';
  value?: string | number | boolean | string[];
}

export interface FormField {
  /** Stable key. This is what the answer is stored under, so it is immutable. */
  key: string;
  type: FormFieldType;
  labelAr: string;
  labelEn: string;
  hintAr?: string;
  hintEn?: string;
  required?: boolean;
  /** Applies only when the field is visible — see `isFieldVisible`. */
  validation?: FieldValidation;
  options?: FormOption[];
  /** For PHOTO/FILE: the media category code the upload is filed under. */
  mediaCategoryCode?: string;
  /** For PHOTO: how many are wanted. */
  minCount?: number;
  maxCount?: number;
  /** For RATING: the top of the scale. */
  scale?: number;
  /** For TABLE/REPEATER: the columns or the repeated group. */
  fields?: FormField[];
  /**
   * All conditions must hold for the field to show. AND rather than a nested
   * boolean tree: every real form in this domain expresses "show these when
   * Customer Found = NO", and an expression language would be a builder UI
   * nobody can use.
   */
  visibleWhen?: VisibilityCondition[];
  /** Layout hint for the renderer, 1–12 columns. */
  width?: number;
}

export interface FormSection {
  key: string;
  titleAr: string;
  titleEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  fields: FormField[];
  visibleWhen?: VisibilityCondition[];
}

export interface FormSchema {
  sections: FormSection[];
}

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;

/**
 * Validate a schema on publish.
 *
 * Collects every problem rather than throwing on the first, because a form
 * builder that reports one error per save attempt is a form builder people
 * stop using.
 */
export function validateFormSchema(schema: unknown): FormSchema {
  const problems: string[] = [];

  if (!schema || typeof schema !== 'object') {
    throw new BadRequestException(
      'النموذج غير صالح - The form schema is invalid',
    );
  }

  const candidate = schema as FormSchema;

  if (!Array.isArray(candidate.sections) || candidate.sections.length === 0) {
    throw new BadRequestException(
      'النموذج يجب أن يحتوي على قسم واحد على الأقل - ' +
        'A form must have at least one section',
    );
  }

  const seenSectionKeys = new Set<string>();
  const allFieldKeys = new Set<string>();

  for (const [sectionIndex, section] of candidate.sections.entries()) {
    const where = `section ${sectionIndex + 1}`;

    if (!section.key || !KEY_PATTERN.test(section.key)) {
      problems.push(
        `${where}: key must start with a letter and be alphanumeric`,
      );
    } else if (seenSectionKeys.has(section.key)) {
      problems.push(`${where}: duplicate section key "${section.key}"`);
    } else {
      seenSectionKeys.add(section.key);
    }

    if (!section.titleAr?.trim() || !section.titleEn?.trim()) {
      problems.push(`${where}: both Arabic and English titles are required`);
    }

    if (!Array.isArray(section.fields)) {
      problems.push(`${where}: fields must be a list`);
      continue;
    }

    for (const field of section.fields) {
      validateField(
        field,
        `${where} / field "${field?.key ?? '?'}"`,
        problems,
        allFieldKeys,
      );
    }
  }

  // A condition naming a field that does not exist silently hides its owner
  // forever, which looks like the form losing a question at random.
  for (const section of candidate.sections) {
    for (const condition of section.visibleWhen ?? []) {
      if (!allFieldKeys.has(condition.field)) {
        problems.push(
          `section "${section.key}": visibleWhen refers to unknown field "${condition.field}"`,
        );
      }
    }
    for (const field of section.fields ?? []) {
      for (const condition of field.visibleWhen ?? []) {
        if (!allFieldKeys.has(condition.field)) {
          problems.push(
            `field "${field.key}": visibleWhen refers to unknown field "${condition.field}"`,
          );
        }
        if (condition.field === field.key) {
          problems.push(`field "${field.key}": cannot depend on itself`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new BadRequestException({
      message: 'النموذج يحتوي على أخطاء - The form schema has errors',
      errorCode: 'INVALID_FORM_SCHEMA',
      problems,
    });
  }

  return candidate;
}

function validateField(
  field: FormField,
  where: string,
  problems: string[],
  allKeys: Set<string>,
  depth = 0,
): void {
  if (!field || typeof field !== 'object') {
    problems.push(`${where}: not an object`);
    return;
  }

  if (!field.key || !KEY_PATTERN.test(field.key)) {
    problems.push(`${where}: key must start with a letter and be alphanumeric`);
  } else if (allKeys.has(field.key)) {
    // Two fields with one key means one answer overwrites the other.
    problems.push(`${where}: duplicate field key "${field.key}"`);
  } else {
    allKeys.add(field.key);
  }

  if (!FIELD_TYPES.includes(field.type)) {
    problems.push(`${where}: unknown field type "${field.type}"`);
    return;
  }

  if (!field.labelAr?.trim() || !field.labelEn?.trim()) {
    problems.push(`${where}: both Arabic and English labels are required`);
  }

  if (OPTION_TYPES.includes(field.type)) {
    if (!Array.isArray(field.options) || field.options.length === 0) {
      problems.push(
        `${where}: a ${field.type} field needs at least one option`,
      );
    } else {
      const values = new Set<string>();
      for (const option of field.options) {
        if (!option.value?.trim()) {
          problems.push(`${where}: an option has no value`);
        } else if (values.has(option.value)) {
          problems.push(`${where}: duplicate option value "${option.value}"`);
        } else {
          values.add(option.value);
        }
        if (!option.labelAr?.trim() || !option.labelEn?.trim()) {
          problems.push(
            `${where}: option "${option.value}" needs both Arabic and English labels`,
          );
        }
      }
    }
  }

  if (CONTAINER_TYPES.includes(field.type)) {
    if (depth >= 1) {
      // One level of nesting. A repeater inside a repeater is unusable on a
      // phone and turns answer storage into an unbounded tree.
      problems.push(`${where}: ${field.type} cannot be nested further`);
      return;
    }
    if (!Array.isArray(field.fields) || field.fields.length === 0) {
      problems.push(`${where}: a ${field.type} needs at least one child field`);
    } else {
      for (const child of field.fields) {
        validateField(
          child,
          `${where} / child "${child?.key ?? '?'}"`,
          problems,
          allKeys,
          depth + 1,
        );
      }
    }
  }

  if (
    field.validation?.pattern &&
    !(field.validation.pattern in NAMED_PATTERNS)
  ) {
    problems.push(
      `${where}: unknown pattern "${field.validation.pattern}"; allowed: ${Object.keys(NAMED_PATTERNS).join(', ')}`,
    );
  }

  if (
    field.type === 'RATING' &&
    field.scale &&
    (field.scale < 2 || field.scale > 10)
  ) {
    problems.push(`${where}: rating scale must be between 2 and 10`);
  }
}

/**
 * A form answer as a comparable string.
 *
 * Answers are `unknown`: a text field yields a string, a number field a
 * number, a repeating group or a GPS field an object. `String()` on the last
 * of those gives "[object Object]" — so two entirely unrelated object answers
 * compare EQUAL, and one condition would reveal a section meant for another.
 * An object has no scalar to compare, so it reads as empty.
 */
function comparable(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
}

/**
 * Whether a field's conditions are satisfied by the current answers.
 *
 * Shared by the answer validator here and — through the same schema — by the
 * client renderer, so a field the investigator never saw is never counted as a
 * missing required answer.
 */
export function isVisible(
  conditions: VisibilityCondition[] | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) return true;

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
        return isEmpty(actual);
      case 'IS_NOT_EMPTY':
        return !isEmpty(actual);
      default:
        return true;
    }
  });
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export interface AnswerProblem {
  field: string;
  labelAr: string;
  labelEn: string;
  reasonAr: string;
  reasonEn: string;
}

/**
 * Validate submitted answers against the version the case was assigned.
 *
 * Runs server-side on submission — the client validates too, for the user's
 * sake, but that validation is a convenience and this one is the rule. A
 * mobile client with an out-of-date schema cached, or one somebody has
 * modified, cannot submit an answer set the form does not allow.
 */
export function validateAnswers(
  schema: FormSchema,
  answers: Record<string, unknown>,
): { valid: boolean; problems: AnswerProblem[] } {
  const problems: AnswerProblem[] = [];

  for (const section of schema.sections) {
    if (!isVisible(section.visibleWhen, answers)) continue;

    for (const field of section.fields) {
      if (field.type === 'SECTION_NOTE') continue;
      if (!isVisible(field.visibleWhen, answers)) continue;

      checkField(field, answers[field.key], answers, problems);
    }
  }

  return { valid: problems.length === 0, problems };
}

function checkField(
  field: FormField,
  value: unknown,
  answers: Record<string, unknown>,
  problems: AnswerProblem[],
): void {
  const push = (reasonAr: string, reasonEn: string) =>
    problems.push({
      field: field.key,
      labelAr: field.labelAr,
      labelEn: field.labelEn,
      reasonAr,
      reasonEn,
    });

  if (isEmpty(value)) {
    if (field.required) push('هذا الحقل مطلوب', 'This field is required');
    // Nothing further to check on an empty optional field.
    return;
  }

  const rules = field.validation ?? {};

  switch (field.type) {
    case 'TEXT':
    case 'LONG_TEXT':
    case 'ADDRESS': {
      const text = String(value);
      if (rules.minLength && text.length < rules.minLength) {
        push(
          `الحد الأدنى ${rules.minLength} حرف`,
          `Must be at least ${rules.minLength} characters`,
        );
      }
      if (rules.maxLength && text.length > rules.maxLength) {
        push(
          `الحد الأقصى ${rules.maxLength} حرف`,
          `Must be at most ${rules.maxLength} characters`,
        );
      }
      if (rules.pattern && !NAMED_PATTERNS[rules.pattern].test(text)) {
        push('التنسيق غير صحيح', 'The format is not valid');
      }
      break;
    }

    case 'NUMBER':
    case 'RATING': {
      const num = Number(value);
      if (Number.isNaN(num)) {
        push('القيمة يجب أن تكون رقمًا', 'Value must be a number');
        break;
      }
      if (rules.min !== undefined && num < rules.min) {
        push(`الحد الأدنى ${rules.min}`, `Must be at least ${rules.min}`);
      }
      if (rules.max !== undefined && num > rules.max) {
        push(`الحد الأقصى ${rules.max}`, `Must be at most ${rules.max}`);
      }
      if (field.type === 'RATING' && field.scale && num > field.scale) {
        push(`الحد الأقصى ${field.scale}`, `Must be at most ${field.scale}`);
      }
      break;
    }

    case 'DATE':
    case 'DATETIME':
    case 'TIME': {
      if (Number.isNaN(new Date(String(value)).getTime())) {
        push('تاريخ غير صالح', 'Invalid date');
      }
      break;
    }

    case 'DROPDOWN':
    case 'RADIO': {
      const allowed = new Set((field.options ?? []).map((o) => o.value));
      if (!allowed.has(String(value))) {
        push('الاختيار غير صالح', 'Not one of the allowed options');
      }
      break;
    }

    case 'MULTI_SELECT':
    case 'CHECKBOX': {
      const values = Array.isArray(value) ? value : [value];
      const allowed = new Set((field.options ?? []).map((o) => o.value));
      for (const item of values) {
        if (!allowed.has(String(item))) {
          push(
            'أحد الاختيارات غير صالح',
            'One of the selections is not allowed',
          );
          break;
        }
      }
      if (rules.minItems && values.length < rules.minItems) {
        push(
          `اختر ${rules.minItems} على الأقل`,
          `Select at least ${rules.minItems}`,
        );
      }
      if (rules.maxItems && values.length > rules.maxItems) {
        push(
          `اختر ${rules.maxItems} كحد أقصى`,
          `Select at most ${rules.maxItems}`,
        );
      }
      break;
    }

    case 'PHOTO':
    case 'FILE':
    case 'SIGNATURE': {
      // The answer is a list of media asset ids. Their existence and ownership
      // are checked by the submission service, which can see the database; this
      // only checks the count the form asked for.
      const ids = Array.isArray(value) ? value : [value];
      if (field.minCount && ids.length < field.minCount) {
        push(
          `مطلوب ${field.minCount} على الأقل`,
          `At least ${field.minCount} required`,
        );
      }
      if (field.maxCount && ids.length > field.maxCount) {
        push(
          `الحد الأقصى ${field.maxCount}`,
          `At most ${field.maxCount} allowed`,
        );
      }
      break;
    }

    case 'GPS': {
      const point = value as { lat?: number; lng?: number };
      if (
        typeof point?.lat !== 'number' ||
        typeof point?.lng !== 'number' ||
        Math.abs(point.lat) > 90 ||
        Math.abs(point.lng) > 180
      ) {
        push('إحداثيات غير صالحة', 'Invalid coordinates');
      }
      break;
    }

    case 'TABLE':
    case 'REPEATER': {
      const rows = Array.isArray(value) ? value : [];
      if (rules.minItems && rows.length < rules.minItems) {
        push(
          `مطلوب ${rules.minItems} صف على الأقل`,
          `At least ${rules.minItems} row(s) required`,
        );
      }
      for (const row of rows) {
        for (const child of field.fields ?? []) {
          checkField(
            child,
            (row as Record<string, unknown>)?.[child.key],
            answers,
            problems,
          );
        }
      }
      break;
    }

    default:
      break;
  }
}

/** Every field in a schema, flattened — used by the report renderer. */
export function flattenFields(schema: FormSchema): FormField[] {
  const out: FormField[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields) {
      out.push(field);
      if (field.fields) out.push(...field.fields);
    }
  }
  return out;
}

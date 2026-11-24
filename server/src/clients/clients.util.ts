import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { IMPORT_FIELDS } from '../imports/utils/field-catalog';
import { neutraliseFormula } from '../imports/utils/row-validator';

/**
 * One column of a client's inquiry file.
 *
 * `target` is an import field key (`fullName`, `nationalId`, …) when the
 * column feeds something the system already understands, or `null` for a
 * field only this client sends — "loan amount", "branch code". Those are not
 * dropped: they ride on the case in `additionalData.clientFields` and print on
 * the form.
 */
export interface TemplateField {
  key: string;
  header: string;
  target: string | null;
  required: boolean;
}

export const MAX_TEMPLATE_FIELDS = 80;

const TARGETS = new Set(IMPORT_FIELDS.map((field) => field.key));

/** "  Loan   amount " → "loan amount", for comparing headers. */
export function headerKey(header: string): string {
  return header.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Check and tidy a template as submitted.
 *
 * Every problem is reported at once, keyed by row, rather than the first one
 * only — the editor marks them all in place.
 */
export function normaliseTemplateFields(
  input: {
    key?: string;
    header: string;
    target?: string | null;
    required?: boolean;
  }[],
): TemplateField[] {
  const problems: { index: number; messageAr: string; messageEn: string }[] =
    [];
  const headers = new Map<string, number>();
  const targets = new Map<string, number>();
  const keys = new Set<string>();

  const fields = input.map((raw, index) => {
    const header = (raw.header ?? '').trim().replace(/\s+/g, ' ');
    const target = raw.target ? raw.target : null;

    if (!header) {
      problems.push({
        index,
        messageAr: 'اسم العمود فارغ',
        messageEn: 'The column name is empty',
      });
    } else {
      const seen = headers.get(headerKey(header));
      if (seen !== undefined) {
        problems.push({
          index,
          messageAr: `اسم العمود مكرر (الصف ${seen + 1})`,
          messageEn: `Duplicate column name (row ${seen + 1})`,
        });
      } else {
        headers.set(headerKey(header), index);
      }
    }

    if (target !== null) {
      if (!TARGETS.has(target)) {
        problems.push({
          index,
          messageAr: 'حقل غير معروف',
          messageEn: 'Unknown field',
        });
      } else {
        const seen = targets.get(target);
        if (seen !== undefined) {
          problems.push({
            index,
            messageAr: `الحقل مربوط بعمودين (الصف ${seen + 1})`,
            messageEn: `This field is already linked to row ${seen + 1}`,
          });
        } else {
          targets.set(target, index);
        }
      }
    }

    // Keys identify a client-only field across template edits, so a renamed
    // column keeps its values. A missing or clashing key gets a new one.
    let key =
      typeof raw.key === 'string' && /^[a-z0-9-]{4,40}$/i.test(raw.key)
        ? raw.key
        : '';
    if (!key || keys.has(key)) key = randomUUID().slice(0, 8);
    keys.add(key);

    return { key, header, target, required: Boolean(raw.required) };
  });

  if (fields.length > 0 && !targets.has('fullName')) {
    problems.push({
      index: -1,
      messageAr: 'لازم عمود واحد على الأقل يتربط بـ«اسم العميل»',
      messageEn: 'One column must be linked to the customer name',
    });
  }

  if (problems.length > 0) {
    throw new BadRequestException({
      message: 'قالب الجهة به أخطاء - The client template has problems',
      problems,
    });
  }
  return fields;
}

/** `{ systemField: header }` — the mapping shape the import pipeline takes. */
export function mappingFrom(fields: TemplateField[]): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter((field) => field.target)
      .map((field) => [field.target!, field.header]),
  );
}

/** The client-only columns, which the pipeline carries but does not interpret. */
export function customFieldsFrom(fields: TemplateField[]): TemplateField[] {
  return fields.filter((field) => !field.target);
}

/** Read a stored template defensively: it is JSON and could predate a change. */
export function readTemplate(value: unknown): TemplateField[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is TemplateField =>
      Boolean(item) &&
      typeof item.header === 'string' &&
      typeof item.key === 'string',
  );
}

/**
 * A blank workbook with the client's own columns, in their order.
 *
 * Headers only — no sample row. A sample row in a template is a row someone
 * forgets to delete, and here it would become a real case.
 */
export function buildClientTemplateWorkbook(
  fields: TemplateField[],
  options: { rtl: boolean; sheetName: string },
): Buffer {
  const headers = fields.map((field) => field.header);
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  sheet['!cols'] = headers.map((header) => ({
    wch: Math.max(14, header.length + 4),
  }));

  const workbook = XLSX.utils.book_new();
  // Excel limits sheet names to 31 characters and forbids a few symbols.
  const name =
    options.sheetName
      .replace(/[\\/?*[\]:]/g, ' ')
      .slice(0, 31)
      .trim() || 'Cases';
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  if (options.rtl) {
    workbook.Workbook = {
      ...(workbook.Workbook ?? {}),
      Views: [{ RTL: true }],
    };
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** A stable code from the English name: "Banque Misr" → "BANQUE_MISR". */
export function codeFrom(nameEn: string): string {
  const code = nameEn
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 30);
  return code || 'CLIENT';
}

/**
 * The file's columns that nothing reads — not linked to a system field, not in
 * the client's template. They are not thrown away: each row keeps them as
 * labelled text (`additionalData.extraFields`), and the preview warns.
 */
export function extraColumns(
  headers: string[],
  mapping: Record<string, string>,
  custom: TemplateField[],
): TemplateField[] {
  const used = new Set(
    [...Object.values(mapping), ...custom.map((field) => field.header)].map(
      headerKey,
    ),
  );
  return headers
    .filter((header) => header && !used.has(headerKey(header)))
    .map((header, index) => ({
      key: `x${index + 1}`,
      header,
      target: null,
      required: false,
    }));
}

/** One client-only value as stored on the case: label kept with the value. */
export interface ClientFieldValue {
  key: string;
  label: string;
  value: string;
}

/**
 * Read a row's client-only columns.
 *
 * Kept as text, label and all: the case must still say "Loan amount: 250,000"
 * after the client renames or drops that column from its template. A required
 * one that is empty fails the row, like any required field.
 */
export function readClientFields(
  raw: Record<string, unknown>,
  fields: TemplateField[],
): {
  values: ClientFieldValue[];
  errors: {
    field: string;
    column: string;
    reasonAr: string;
    reasonEn: string;
  }[];
} {
  const values: ClientFieldValue[] = [];
  const errors: {
    field: string;
    column: string;
    reasonAr: string;
    reasonEn: string;
  }[] = [];

  for (const field of fields) {
    const text = cellText(raw[field.header]);
    if (text === null) {
      if (field.required) {
        errors.push({
          field: `client:${field.key}`,
          column: field.header,
          reasonAr: 'حقل إجباري فارغ',
          reasonEn: 'Required field is empty',
        });
      }
      continue;
    }
    values.push({
      key: field.key,
      label: field.header,
      value: neutraliseFormula(text).slice(0, 500),
    });
  }
  return { values, errors };
}

function cellText(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime())
      ? null
      : cell.toISOString().slice(0, 10);
  }
  if (
    typeof cell !== 'string' &&
    typeof cell !== 'number' &&
    typeof cell !== 'boolean'
  ) {
    return null;
  }
  const text = String(cell).trim();
  return text === '' ? null : text;
}

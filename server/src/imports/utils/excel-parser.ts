import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

/**
 * Reading the workbook, and nothing else.
 *
 * Kept separate from validation so the parser can be tested against real files
 * without a database, and so the mapping screen can show the user their own
 * headers before anything has been validated at all.
 *
 * ROW CAP. A 200,000-row file read into memory is a container restart. The cap
 * is enforced here, at the point where the cost is incurred, and reported as a
 * message that tells the user what to do about it rather than a 500.
 */

const MAX_ROWS = 50_000;
const MAX_COLUMNS = 200;

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  /** Row objects keyed by header, in sheet order. */
  rows: Record<string, unknown>[];
  totalRows: number;
}

export interface WorkbookSummary {
  sheetNames: string[];
  /** The sheet that will be read if none is named — the first non-empty one. */
  defaultSheet: string;
}

/**
 * `cellDates` matters: without it every date arrives as an Excel serial number
 * and the validator has to guess whether 45000 is a date or a loan amount.
 * `raw: false` is deliberately NOT set — formatted strings lose precision on
 * long national ids, which Excel renders as 2.79012E+13.
 */
function read(buffer: Buffer): XLSX.WorkBook {
  try {
    return XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellNF: false,
      cellText: false,
      // Formulas are not evaluated; the cached value is used. An imported file
      // is data, and evaluating a stranger's formulas is not something this
      // process should be doing.
      cellFormula: false,
    });
  } catch {
    throw new BadRequestException(
      'تعذر قراءة الملف، تأكد أنه ملف Excel صالح - ' +
        'Could not read the file; make sure it is a valid Excel workbook',
    );
  }
}

export function summariseWorkbook(buffer: Buffer): WorkbookSummary {
  const workbook = read(buffer);
  const sheetNames = workbook.SheetNames.filter((name) => {
    const sheet = workbook.Sheets[name];
    return sheet && sheet['!ref'];
  });

  if (sheetNames.length === 0) {
    throw new BadRequestException(
      'الملف لا يحتوي على أي بيانات - The workbook contains no data',
    );
  }

  return { sheetNames, defaultSheet: sheetNames[0] };
}

/**
 * Read one sheet into header + row objects.
 *
 * `headerRow` is 1-based and lets a coordinator import a file whose first two
 * rows are a bank's letterhead — which is most of them.
 */
export function parseSheet(
  buffer: Buffer,
  options: { sheetName?: string; headerRow?: number } = {},
): ParsedSheet {
  const workbook = read(buffer);
  const sheetName = options.sheetName ?? summariseWorkbook(buffer).defaultSheet;
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new BadRequestException(
      `الورقة "${sheetName}" غير موجودة - Sheet "${sheetName}" was not found`,
    );
  }

  const headerRowIndex = Math.max(1, options.headerRow ?? 1);

  // Read as a matrix first: `sheet_to_json` with objects silently renames
  // duplicate headers to `Name_1`, which then does not match the saved mapping.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true,
  });

  if (matrix.length < headerRowIndex) {
    throw new BadRequestException(
      'الملف فارغ أو صف العناوين غير صحيح - ' +
        'The file is empty, or the header row number is wrong',
    );
  }

  const rawHeaders = matrix[headerRowIndex - 1] ?? [];
  if (rawHeaders.length > MAX_COLUMNS) {
    throw new BadRequestException(
      `الملف يحتوي على ${rawHeaders.length} عمودًا، الحد الأقصى ${MAX_COLUMNS} - ` +
        `The sheet has ${rawHeaders.length} columns; the maximum is ${MAX_COLUMNS}`,
    );
  }

  // Duplicate headers are disambiguated with a suffix rather than dropped —
  // a bank file with two "Phone" columns has two phone numbers in it, and
  // losing the second silently is worse than an odd label on the mapping
  // screen.
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((raw, index) => {
    // An object-valued header cell has no usable text; naming it by
    // position beats labelling a column "[object Object]".
    const base =
      (typeof raw === 'object' || raw === null || raw === undefined
        ? ''
        : // eslint-disable-next-line @typescript-eslint/no-base-to-string
          String(raw)
      ).trim() || `Column ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });

  const dataRows = matrix.slice(headerRowIndex);
  const totalRows = dataRows.length;

  if (totalRows > MAX_ROWS) {
    throw new BadRequestException(
      `الملف يحتوي على ${totalRows} صفًا، الحد الأقصى ${MAX_ROWS} صف لكل دفعة. ` +
        `يرجى تقسيم الملف - ` +
        `The file has ${totalRows} rows; the maximum is ${MAX_ROWS} per batch. ` +
        `Please split it.`,
    );
  }

  const rows = dataRows.map((cells) => {
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? null;
    });
    return row;
  });

  return { sheetName, headers, rows, totalRows };
}

/**
 * Build the error report a user downloads: their own rows, with a column of
 * problems appended.
 *
 * The original values are written back verbatim so the file can be corrected
 * and re-uploaded as-is — which is the whole workflow the preview screen is
 * built around.
 */
export function buildErrorWorkbook(
  headers: string[],
  rows: {
    rowNumber: number;
    data: Record<string, unknown>;
    errors: { column: string; reasonEn: string; reasonAr: string }[];
  }[],
): Buffer {
  const sheetRows = rows.map((row) => {
    const record: Record<string, unknown> = { 'Row / الصف': row.rowNumber };
    for (const header of headers) {
      record[header] = row.data[header] ?? '';
    }
    record['Problems / المشاكل'] = row.errors
      .map((e) => `[${e.column}] ${e.reasonEn} — ${e.reasonAr}`)
      .join(' | ');
    return record;
  });

  const sheet = XLSX.utils.json_to_sheet(sheetRows, {
    header: ['Row / الصف', ...headers, 'Problems / المشاكل'],
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Errors');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** A template file with the catalogue's headers, for a client with no format. */
export function buildTemplateWorkbook(
  columns: { header: string; example: string }[],
): Buffer {
  const sheet = XLSX.utils.json_to_sheet(
    [Object.fromEntries(columns.map((c) => [c.header, c.example]))],
    { header: columns.map((c) => c.header) },
  );

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Cases');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

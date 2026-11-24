import * as XLSX from 'xlsx';
import {
  buildClientTemplateWorkbook,
  codeFrom,
  extraColumns,
  customFieldsFrom,
  mappingFrom,
  normaliseTemplateFields,
  readClientFields,
} from './clients.util';

const problemsOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (
      error as {
        getResponse(): { problems: { index: number; messageEn: string }[] };
      }
    ).getResponse().problems;
  }
  throw new Error('expected a BadRequestException');
};

describe('client templates', () => {
  const base = [
    { header: ' اسم  العميل ', target: 'fullName', required: true },
    { header: 'رقم الطلب', target: 'applicationNumber' },
    { header: 'مبلغ التمويل', target: null },
  ];

  it('tidies headers and gives every field a key', () => {
    const fields = normaliseTemplateFields(base);
    expect(fields[0]).toMatchObject({
      header: 'اسم العميل',
      target: 'fullName',
      required: true,
    });
    expect(fields[2]).toMatchObject({ target: null, required: false });
    expect(new Set(fields.map((f) => f.key)).size).toBe(3);
  });

  it('keeps an existing key so a renamed column keeps its meaning', () => {
    const [field] = normaliseTemplateFields([
      { key: 'loan-amt', header: 'X', target: 'fullName' },
    ]);
    expect(field.key).toBe('loan-amt');
  });

  it('reports every problem at once, by row', () => {
    const problems = problemsOf(() =>
      normaliseTemplateFields([
        { header: 'Name', target: 'fullName' },
        { header: 'name', target: null },
        { header: '', target: 'mobile' },
        { header: 'Mobile 2', target: 'mobile' },
        { header: 'Odd', target: 'notAField' },
      ]),
    );
    expect(problems.map((p) => p.index)).toEqual([1, 2, 3, 4]);
  });

  it('insists that some column is the customer name', () => {
    const problems = problemsOf(() =>
      normaliseTemplateFields([{ header: 'Mobile', target: 'mobile' }]),
    );
    expect(problems[0].index).toBe(-1);
  });

  it('splits into an import mapping and client-only columns', () => {
    const fields = normaliseTemplateFields(base);
    expect(mappingFrom(fields)).toEqual({
      fullName: 'اسم العميل',
      applicationNumber: 'رقم الطلب',
    });
    expect(customFieldsFrom(fields).map((f) => f.header)).toEqual([
      'مبلغ التمويل',
    ]);
  });

  it('reads client-only values with their label, and neutralises formulas', () => {
    const fields = normaliseTemplateFields([
      ...base,
      { header: 'الفرع', target: null, required: true },
    ]);
    const custom = customFieldsFrom(fields);

    const ok = readClientFields(
      { 'مبلغ التمويل': '=1+1', الفرع: 'المعادي' },
      custom,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.values.map((v) => [v.label, v.value])).toEqual([
      ['مبلغ التمويل', "'=1+1"],
      ['الفرع', 'المعادي'],
    ]);

    const missing = readClientFields({ 'مبلغ التمويل': '5' }, custom);
    expect(missing.errors).toHaveLength(1);
    expect(missing.errors[0].column).toBe('الفرع');
  });

  it('builds a headers-only workbook in the template order', () => {
    const fields = normaliseTemplateFields(base);
    const buffer = buildClientTemplateWorkbook(fields, {
      rtl: true,
      sheetName: 'بنك/مصر',
    });
    const book = XLSX.read(buffer, { type: 'buffer' });
    const sheet = book.Sheets[book.SheetNames[0]];
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      ['اسم العميل', 'رقم الطلب', 'مبلغ التمويل'],
    ]);
    expect(book.SheetNames[0]).toBe('بنك مصر');
  });

  it('derives a code from the English name', () => {
    expect(codeFrom('Banque Misr')).toBe('BANQUE_MISR');
    expect(codeFrom('  CIB (Egypt) ')).toBe('CIB_EGYPT');
    expect(codeFrom('بنك')).toBe('CLIENT');
  });

  it('keeps the columns nothing reads, so they are saved rather than dropped', () => {
    const custom = customFieldsFrom(normaliseTemplateFields(base));
    const extra = extraColumns(
      ['اسم العميل', 'Email', 'مبلغ التمويل', 'DPD'],
      { fullName: 'اسم  العميل ' },
      custom,
    );
    expect(extra.map((field) => field.header)).toEqual(['Email', 'DPD']);
    expect(readClientFields({ Email: 'a@b.c' }, extra).values[0]).toMatchObject(
      {
        label: 'Email',
        value: 'a@b.c',
      },
    );
  });
});

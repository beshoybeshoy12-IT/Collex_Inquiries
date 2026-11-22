import {
  INQUIRY_FORMS,
  RESIDENCE_FORM_SCHEMA,
  WORKPLACE_FORM_SCHEMA,
} from '../../prisma/seed-data/forms';
import { flattenFields, validateAnswers, validateFormSchema } from './form-schema';

/**
 * The residence and work inquiry forms, as shipped in the seed.
 *
 * These are data, but they are data that `db:inquiry-forms` publishes into
 * live tenants — and a published version cannot be edited afterwards. A
 * schema the validator would refuse, discovered only when the install script
 * runs against production, is a failed deploy step; caught here, it is a red
 * test.
 */
describe('inquiry forms', () => {
  it.each(INQUIRY_FORMS.map((f) => [f.templateCode, f.schema] as const))(
    '%s passes the publish-time schema validator',
    (_code, schema) => {
      expect(() => validateFormSchema(schema)).not.toThrow();
    },
  );

  it('accepts an entirely empty answer set', () => {
    // A deliberate product choice, not an oversight. The paper forms are full
    // of "not stated", and a reviewer typing one in saves as they go; a form
    // that refused to submit until the company's capital was known would be
    // filled with invented numbers instead.
    for (const { schema } of INQUIRY_FORMS) {
      expect(validateAnswers(schema, {}).valid).toBe(true);
    }
  });

  it('draws every choice row as a single-tick line, as on paper', () => {
    for (const { schema } of INQUIRY_FORMS) {
      const choices = flattenFields(schema).filter((f) => f.options?.length);
      expect(choices.length).toBeGreaterThan(0);
      for (const field of choices) expect(field.type).toBe('RADIO');
    }
  });

  it('refuses an answer that is not one of the printed boxes', () => {
    const result = validateAnswers(RESIDENCE_FORM_SCHEMA, {
      propertyType: 'CASTLE',
    });
    expect(result.valid).toBe(false);
    expect(result.problems[0].field).toBe('propertyType');
  });

  it('ends both forms with the same sign-off row', () => {
    const lastKeys = (schema: typeof RESIDENCE_FORM_SCHEMA) =>
      schema.sections.at(-1)!.fields.map((f) => f.key);

    expect(lastKeys(RESIDENCE_FORM_SCHEMA)).toEqual(lastKeys(WORKPLACE_FORM_SCHEMA));
    expect(lastKeys(RESIDENCE_FORM_SCHEMA)).toEqual([
      'investigatorName',
      'reviewerName',
      'followUpName',
      'inquiryDate',
      'inquiryTime',
    ]);
  });
});

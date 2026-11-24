import { useTranslation } from 'react-i18next';
import { localisedLabel, localisedName } from '../../i18n';
import { conditionsMet } from '../../utils/formConditions';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A form drawn as the paper inquiry sheet.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  One component, three uses, all from the same published schema:
 *
 *    - EDIT — the office types in the paper form an investigator brought
 *      back. Choice rows are tick boxes, text answers are ruled lines.
 *    - READ — the same sheet, filled, for printing a completed form.
 *    - BLANK — every line empty and every condition ignored, printed for an
 *      investigator to fill in by hand. Nothing is hidden on a blank sheet:
 *      the person holding the pen decides which branch applies.
 *
 *  Nothing here knows the residence or work form. The layout comes from the
 *  schema (sections, field `width` on a 12-column grid), so a tenant that
 *  builds a third form in the builder gets a printable sheet for it without a
 *  deploy.
 *
 *  A choice row is drawn as tick boxes whatever its type. RADIO keeps the
 *  one-tick-per-line rule of the paper form: ticking a second box moves the
 *  tick, and ticking the same box again clears it, because on paper an
 *  unticked line is a legitimate answer ("not asked").
 *
 * @param {object} props
 * @param {string} props.title
 * @param {{label: string, value?: string}[]} props.header  Case facts printed above the form.
 * @param {{sections: any[]}} props.schema
 * @param {Record<string, unknown>} [props.answers]
 * @param {(key: string, value: unknown) => void} [props.onChange]  Omit for a read-only sheet.
 * @param {boolean} [props.blank]
 * @param {{ client: object|null, logoUrl?: string|null }} [props.brand]
 *   The bank or company the inquiry is for: its logo and name head the sheet.
 */
export default function InquirySheet({
  title,
  header,
  schema,
  answers = {},
  onChange,
  blank = false,
  brand = null,
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const values = blank ? {} : answers;
  const editable = Boolean(onChange) && !blank;

  const shown = (conditions) => blank || conditionsMet(conditions, values);

  return (
    <div className="ci-sheet">
      {brand?.client && (
        <div className="ci-sheet-brand">
          {brand.logoUrl ? (
            <img className="ci-sheet-brand__logo" src={brand.logoUrl} alt="" />
          ) : null}
          <div className="ci-sheet-brand__name">
            <span className="ci-sheet-label">{t('inquirySheet.forClient')}:</span>{' '}
            <strong>{localisedName(brand.client, language)}</strong>
          </div>
        </div>
      )}
      <h2 className="ci-sheet-title">{title}</h2>

      <div className="ci-sheet-grid ci-sheet-header">
        {header.map((item) => (
          <div className="ci-sheet-cell ci-span-6" key={item.label}>
            <span className="ci-sheet-label">{item.label}:</span>
            <span className="ci-sheet-line">{item.value || ' '}</span>
          </div>
        ))}
      </div>

      {(schema?.sections ?? []).filter((section) => shown(section.visibleWhen)).map((section) => (
        <section className="ci-sheet-section" key={section.key}>
          <h3 className="ci-sheet-section-title">{localisedLabel(section, language)}</h3>
          <div className="ci-sheet-grid">
            {(section.fields ?? [])
              .filter((field) => shown(field.visibleWhen))
              .map((field) => (
                <SheetField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  language={language}
                  onChange={editable ? (value) => onChange(field.key, value) : null}
                  blank={blank}
                />
              ))}
          </div>
        </section>
      ))}

      <div className="ci-sheet-stamp">{t('inquirySheet.officeStamp')}</div>
    </div>
  );
}

/** Long answers get a box; everything else sits on one line. */
const BOX_TYPES = ['LONG_TEXT'];
const INPUT_TYPES = {
  TEXT: 'text',
  ADDRESS: 'text',
  NUMBER: 'number',
  DATE: 'date',
  TIME: 'time',
  DATETIME: 'datetime-local',
};

function SheetField({ field, value, language, onChange, blank }) {
  const label = localisedLabel(field, language);
  const span = `ci-span-${Math.min(Math.max(field.width || 12, 1), 12)}`;
  const id = `sheet-${field.key}`;

  if (field.type === 'SECTION_NOTE') {
    return <p className={`ci-sheet-cell ${span} ci-sheet-note mb-0`}>{label}</p>;
  }

  if (field.options?.length) {
    return (
      <div className={`ci-sheet-cell ${span}`} role="group" aria-labelledby={`${id}-label`}>
        <span className="ci-sheet-label" id={`${id}-label`}>
          {label}:
        </span>
        <span className="ci-sheet-ticks">
          {field.options.map((option) => (
            <Tick
              key={option.value}
              label={localisedLabel(option, language)}
              checked={isTicked(field, value, option.value)}
              onToggle={onChange ? () => onChange(toggle(field, value, option.value)) : null}
            />
          ))}
        </span>
      </div>
    );
  }

  if (BOX_TYPES.includes(field.type)) {
    return (
      <div className={`ci-sheet-cell ci-sheet-cell-box ${span}`}>
        <label className="ci-sheet-label" htmlFor={id}>
          {label}:
        </label>
        {onChange ? (
          <textarea
            id={id}
            className="ci-sheet-box"
            rows={4}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <div className="ci-sheet-box">{blank ? '' : (value ?? '')}</div>
        )}
      </div>
    );
  }

  const inputType = INPUT_TYPES[field.type];

  return (
    <div className={`ci-sheet-cell ${span}`}>
      <label className="ci-sheet-label" htmlFor={id}>
        {label}:
      </label>
      {onChange && inputType ? (
        <input
          id={id}
          type={inputType}
          className="ci-sheet-line ci-sheet-input"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <span className="ci-sheet-line">{blank ? ' ' : displayValue(value)}</span>
      )}
    </div>
  );
}

function Tick({ label, checked, onToggle }) {
  const icon = (
    <i className={`bi ${checked ? 'bi-check-square-fill' : 'bi-square'}`} aria-hidden="true" />
  );

  if (!onToggle) {
    return (
      <span className="ci-tick" data-checked={checked}>
        {icon}
        {label}
        <span className="visually-hidden">{checked ? ' ✓' : ''}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="ci-tick ci-tick-button"
      onClick={onToggle}
    >
      {icon}
      {label}
    </button>
  );
}

const MULTI = ['CHECKBOX', 'MULTI_SELECT'];

function isTicked(field, value, optionValue) {
  if (MULTI.includes(field.type)) return Array.isArray(value) && value.includes(optionValue);
  return value === optionValue;
}

function toggle(field, value, optionValue) {
  if (MULTI.includes(field.type)) {
    const current = Array.isArray(value) ? value : [];
    return current.includes(optionValue)
      ? current.filter((item) => item !== optionValue)
      : [...current, optionValue];
  }
  return value === optionValue ? '' : optionValue;
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return ' ';
  if (Array.isArray(value)) return value.length ? String(value.length) : ' ';
  if (typeof value === 'object') return ' ';
  return String(value);
}

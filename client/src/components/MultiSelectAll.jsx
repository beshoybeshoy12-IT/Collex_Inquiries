import { useTranslation } from 'react-i18next';
import { localisedName } from '../i18n';

/**
 * A checklist with an "All" box on top. An empty selection means all — the
 * same meaning the server gives an empty list — so "All" is simply "nothing
 * picked", and ticking any item narrows it.
 *
 * @param {{
 *   id: string,
 *   options: { id: string, nameAr?: string, nameEn?: string }[],
 *   value: string[],
 *   onChange: (ids: string[]) => void,
 *   disabled?: boolean,
 * }} props
 */
export default function MultiSelectAll({ id, options, value, onChange, disabled = false }) {
  const { t, i18n } = useTranslation();
  const selected = new Set(value);
  const all = value.length === 0;

  const toggle = (optionId) => {
    const next = new Set(selected);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    // Ticking every item is the same as "All"; keep one meaning for it.
    onChange(next.size === options.length ? [] : [...next]);
  };

  return (
    <div className="multi-all" role="group" aria-labelledby={`${id}-label`}>
      <label className={`multi-all__item multi-all__all ${all ? 'is-on' : ''}`}>
        <input
          type="checkbox"
          className="form-check-input"
          checked={all}
          disabled={disabled}
          onChange={() => onChange([])}
        />
        <span>{t('common.all')}</span>
      </label>
      {options.map((option) => (
        <label
          key={option.id}
          className={`multi-all__item ${selected.has(option.id) ? 'is-on' : ''}`}
        >
          <input
            type="checkbox"
            className="form-check-input"
            checked={selected.has(option.id)}
            disabled={disabled}
            onChange={() => toggle(option.id)}
          />
          <span className="truncate">{localisedName(option, i18n.language)}</span>
        </label>
      ))}
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import Dropdown from './Dropdown';
import { setThemePreference, THEME_PREFERENCES, useTheme } from '../theme';

const ICONS = { light: 'sun', dark: 'moon-stars', system: 'circle-half' };

/**
 * Light / dark / follow-the-system. A menu rather than a two-way switch,
 * because "system" is the right default for most people and a switch has no
 * third position to put it in.
 *
 * The button shows the theme in effect, not the preference: someone on
 * "system" at night sees a moon, which is what is actually on their screen.
 */
export default function ThemeToggle({ buttonClassName = 'header-icon' }) {
  const { t } = useTranslation();
  const { preference, theme } = useTheme();

  return (
    <Dropdown
      buttonClassName={buttonClassName}
      ariaLabel={t('theme.label')}
      label={<i className={`bi bi-${ICONS[theme]}`} aria-hidden="true" />}
    >
      {THEME_PREFERENCES.map((option) => (
        <li key={option}>
          <button
            type="button"
            className={`dropdown-item d-flex align-items-center gap-2 ${
              preference === option ? 'active' : ''
            }`}
            onClick={() => setThemePreference(option)}
            aria-pressed={preference === option}
          >
            <i className={`bi bi-${ICONS[option]}`} aria-hidden="true" />
            <span className="flex-grow-1">{t(`theme.${option}`)}</span>
            {preference === option && <i className="bi bi-check2" aria-hidden="true" />}
          </button>
        </li>
      ))}
    </Dropdown>
  );
}

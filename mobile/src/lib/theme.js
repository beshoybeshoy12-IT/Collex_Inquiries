import { useColorScheme } from 'react-native';

/**
 * The same palette as the office web client (client/src/assets/styles/app.css),
 * so the two read as one product. Light and dark follow the phone's setting.
 * Text colours meet WCAG AA (4.5:1) against the surfaces they sit on.
 */
const light = {
  page: '#f4f6fb',
  surface: '#ffffff',
  surfaceAlt: '#eef1f7',
  border: '#e3e8f0',
  text: '#1d2433',
  strong: '#0b1220',
  muted: '#5b6477',
  primary: '#2f5bea',
  primaryText: '#ffffff',
  primarySoft: '#e8eefe',
  primaryStrong: '#1e3fae',
  success: '#15803d',
  successSoft: '#dcfce7',
  danger: '#b42318',
  dangerSoft: '#fdecec',
  warning: '#a15c07',
  warningSoft: '#fef3c7',
};

const dark = {
  page: '#0b1220',
  surface: '#111a2b',
  surfaceAlt: '#18233a',
  border: '#243049',
  text: '#d9e0ec',
  strong: '#f5f7fb',
  muted: '#a3adc2',
  primary: '#5b7cf6',
  primaryText: '#ffffff',
  primarySoft: 'rgba(91,124,246,0.18)',
  primaryStrong: '#a9bcff',
  success: '#4ade80',
  successSoft: 'rgba(74,222,128,0.14)',
  danger: '#f87171',
  dangerSoft: 'rgba(248,113,113,0.16)',
  warning: '#fbbf24',
  warningSoft: 'rgba(251,191,36,0.16)',
};

export function useColors() {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Which tone a case status is shown in. */
export function statusTone(status) {
  if (['COMPLETED', 'QC_APPROVED', 'SUBMITTED', 'QC_PENDING', 'AUTO_VALIDATION'].includes(status)) {
    return 'success';
  }
  if (['REWORK', 'QC_REJECTED'].includes(status)) return 'danger';
  if (['ASSIGNED'].includes(status)) return 'warning';
  return 'primary';
}

import { useMemo } from 'react';
import { Chart } from 'chart.js';
import { chartColors, useTheme } from '../theme';

/**
 * Chart colours for the current theme.
 *
 * chart.js paints on a canvas, so CSS variables never reach it. This reads
 * the `--ci-chart-*` tokens from the live stylesheet, sets chart.js's global
 * text and grid colours to match, and returns the series palette plus the
 * theme name — pass `key={theme}` to a chart so it repaints when the theme
 * changes instead of keeping the old colours until the next data refresh.
 *
 * Imported only by the pages that draw charts, so chart.js stays off the
 * critical path (see CLAUDE.md).
 *
 * @returns {{ theme: string, series: string[], alpha: (color: string, a: number) => string }}
 */
export default function useChartTheme() {
  const { theme } = useTheme();

  return useMemo(() => {
    const colors = chartColors();
    Chart.defaults.color = colors.text;
    Chart.defaults.borderColor = colors.grid;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    return { theme, series: colors.series, alpha };
  }, [theme]);
}

/** `#rrggbb` → `rgba(r, g, b, a)`, for translucent area fills. */
function alpha(hex, a) {
  const value = hex.replace('#', '');
  const n = parseInt(value.length === 3 ? value.replace(/./g, '$&$&') : value, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

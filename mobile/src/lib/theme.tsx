import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import type { Mode } from './types';

// Same presets as the website (services/categories.py).
export const THEMES: Record<string, { label: string; accent: string; accent2: string }> = {
  paylog: { label: 'Paylog', accent: '#0e5e56', accent2: '#e8a33d' },
  forest: { label: 'Forest', accent: '#1a472a', accent2: '#c17f24' },
  ocean: { label: 'Ocean', accent: '#1d4e89', accent2: '#d0703a' },
  plum: { label: 'Plum', accent: '#5b2a6e', accent2: '#c9973a' },
  terracotta: { label: 'Terracotta', accent: '#9c3d24', accent2: '#3f7c6b' },
  graphite: { label: 'Graphite', accent: '#2f3640', accent2: '#c0563b' },
};

const light = {
  bg: '#f7f6f3',
  card: '#ffffff',
  cardAlt: '#f0ede6',
  ink: '#141413',
  inkSoft: '#2d2d2d',
  muted: '#66645f',
  faint: '#9a978f',
  border: '#e4e1da',
  good: '#0f7a2e',
  goodBg: '#e6f4ea',
  warning: '#9a6200',
  warningBg: '#fdf3dc',
  danger: '#c0392b',
  dangerBg: '#fdecea',
  income: '#2a78d6',
  expense: '#eb6834',
  paper: '#fbf8f1',
};

const dark: typeof light = {
  bg: '#111211',
  card: '#1b1c1b',
  cardAlt: '#232422',
  ink: '#f3f1ec',
  inkSoft: '#d9d6cf',
  muted: '#a5a29a',
  faint: '#75726b',
  border: '#2f2e2b',
  good: '#4cc26a',
  goodBg: '#16301d',
  warning: '#f0b43c',
  warningBg: '#332812',
  danger: '#ef6b5e',
  dangerBg: '#3a1d1a',
  income: '#3987e5',
  expense: '#e0713f',
  paper: '#232422',
};

function mix(hex: string, other: string, amount: number) {
  const a = hex.replace('#', ''), b = other.replace('#', '');
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  const out = [0, 2, 4].map((i) => Math.round(ch(a, i) * (1 - amount) + ch(b, i) * amount));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export type Colors = typeof light & {
  accent: string; // buttons and fills
  accentText: string; // accent used as text on the page background (readable in dark mode)
  accentSoft: string; // tinted backgrounds
  onAccent: string;
  accent2: string;
};

type ThemeValue = { colors: Colors; dark: boolean };

const ThemeContext = createContext<ThemeValue | null>(null);

export function buildColors(isDark: boolean, themeKey = 'paylog', customAccent?: string | null): Colors {
  const base = isDark ? dark : light;
  const preset = THEMES[themeKey] || THEMES.paylog;
  const accent = customAccent || preset.accent;
  return {
    ...base,
    accent: isDark ? mix(accent, '#ffffff', 0.12) : accent,
    accentText: isDark ? mix(accent, '#ffffff', 0.55) : accent,
    accentSoft: isDark ? mix(accent, base.card, 0.72) : mix(accent, '#ffffff', 0.89),
    onAccent: '#ffffff',
    accent2: preset.accent2,
  };
}

export function ThemeProvider({ mode, themeKey, accent, children }: {
  mode?: Mode; themeKey?: string; accent?: string | null; children: ReactNode;
}) {
  const system = useColorScheme();
  const isDark = mode === 'dark' || ((mode || 'system') === 'system' && system === 'dark');
  const value = useMemo(
    () => ({ colors: buildColors(isDark, themeKey, accent), dark: isDark }),
    [isDark, themeKey, accent],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

export function statusColor(colors: Colors, status: 'good' | 'warning' | 'critical' | 'info') {
  if (status === 'good') return { fg: colors.good, bg: colors.goodBg };
  if (status === 'warning') return { fg: colors.warning, bg: colors.warningBg };
  if (status === 'critical') return { fg: colors.danger, bg: colors.dangerBg };
  return { fg: colors.accentText, bg: colors.accentSoft };
}

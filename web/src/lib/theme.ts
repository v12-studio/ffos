import { useEffect, useState } from 'react';

// How the app looks on this device. Saved in localStorage, applied as attributes on <html>
// (index.css reads them). index.html applies the saved choice before the first paint, so there's no flash.

export type ThemeMode = 'system' | 'light' | 'dark';
export type Accent = 'green' | 'blue' | 'purple' | 'teal' | 'orange' | 'rose';
export type TextSize = 'normal' | 'large' | 'larger';

/** The tab between Transactions and Settings on phones. */
export type MiddleTab = 'budget' | 'reports';

/** Cards on the Overview that can be hidden or moved, in their default order. */
export const OVERVIEW_CARDS = ['balances', 'due', 'recent', 'spending', 'trends'] as const;
export type OverviewCard = (typeof OVERVIEW_CARDS)[number];
export const OVERVIEW_CARD_LABELS: Record<OverviewCard, string> = {
  balances: 'Account balances',
  due: 'Repeating entries due',
  recent: 'Recent transactions',
  spending: 'Spending by category',
  trends: 'Last 6 months chart',
};

export interface ThemePrefs {
  mode: ThemeMode;
  accent: Accent;
  text: TextSize;
  tab: MiddleTab;
  /** Overview cards in the order shown; ones left out are hidden. */
  overview: OverviewCard[];
}

const KEY = 'ffos.theme';
const CHANGED = 'ffos-theme-changed';
const DEFAULTS: ThemePrefs = { mode: 'system', accent: 'green', text: 'normal', tab: 'budget', overview: [...OVERVIEW_CARDS] };

/** Swatch colours for the picker (the light-mode primary of each accent in index.css). */
export const ACCENTS: { value: Accent; label: string; swatch: string }[] = [
  { value: 'green', label: 'Green', swatch: '#1b4332' },
  { value: 'blue', label: 'Blue', swatch: '#1e3a8a' },
  { value: 'purple', label: 'Purple', swatch: '#4c1d95' },
  { value: 'teal', label: 'Teal', swatch: '#134e4a' },
  { value: 'orange', label: 'Orange', swatch: '#7c2d12' },
  { value: 'rose', label: 'Rose', swatch: '#881337' },
];

export function loadTheme(): ThemePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ThemePrefs>;
    return {
      mode: ['system', 'light', 'dark'].includes(saved.mode as string) ? saved.mode! : DEFAULTS.mode,
      accent: ACCENTS.some((a) => a.value === saved.accent) ? saved.accent! : DEFAULTS.accent,
      text: ['normal', 'large', 'larger'].includes(saved.text as string) ? saved.text! : DEFAULTS.text,
      tab: saved.tab === 'reports' ? 'reports' : 'budget',
      overview: Array.isArray(saved.overview) ? saved.overview.filter((c, i, all): c is OverviewCard => (OVERVIEW_CARDS as readonly string[]).includes(c) && all.indexOf(c) === i) : DEFAULTS.overview,
    };
  } catch {
    return DEFAULTS;
  }
}

export function applyTheme(prefs: ThemePrefs) {
  const root = document.documentElement;
  root.dataset.theme = prefs.mode;
  root.dataset.accent = prefs.accent;
  root.dataset.text = prefs.text;
  // The phone's status bar colour follows the chosen mode. index.html has two tags: light first, then dark.
  const [light, dark] = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (!light || !dark) return;
  if (prefs.mode === 'system') {
    light.media = '(prefers-color-scheme: light)';
    dark.media = '(prefers-color-scheme: dark)';
  } else {
    light.media = prefs.mode === 'light' ? 'all' : 'not all';
    dark.media = prefs.mode === 'dark' ? 'all' : 'not all';
  }
}

/** This device's look and layout choices; every screen using it updates when one changes them. */
export function useTheme(): [ThemePrefs, (patch: Partial<ThemePrefs>) => void] {
  const [prefs, setPrefs] = useState(loadTheme);
  useEffect(() => {
    const reload = () => setPrefs(loadTheme());
    window.addEventListener(CHANGED, reload);
    return () => window.removeEventListener(CHANGED, reload);
  }, []);
  const update = (patch: Partial<ThemePrefs>) => {
    const next = { ...loadTheme(), ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private mode: still applies for this visit.
    }
    applyTheme(next);
    window.dispatchEvent(new Event(CHANGED));
  };
  return [prefs, update];
}

// Pure theme-preference logic shared by the provider and the shell toggle. No
// React or native imports, so the rules stay easy to test.

import type { KeyValueStorage } from '../i18n/locale';

export type ThemePreference = 'system' | 'light' | 'dark';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
export const THEME_STORAGE_KEY = 'campusute.theme';

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME_PREFERENCE;
}

/** Reads the saved preference; any storage failure falls back to system. */
export async function loadThemePreference(storage?: KeyValueStorage): Promise<ThemePreference> {
  if (!storage) return DEFAULT_THEME_PREFERENCE;
  try {
    const raw = await storage.getItem(THEME_STORAGE_KEY);
    return normalizeThemePreference(raw);
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Returns false when the preference could not be persisted. */
export async function saveThemePreference(
  storage: KeyValueStorage | undefined,
  preference: ThemePreference,
): Promise<boolean> {
  if (!storage) return false;
  try {
    await storage.setItem(THEME_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

// The order the header control cycles through; light → dark matches the web toggle.
const PREFERENCE_CYCLE: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = PREFERENCE_CYCLE.indexOf(current);
  return PREFERENCE_CYCLE[(index + 1) % PREFERENCE_CYCLE.length];
}

export function resolveThemeScheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

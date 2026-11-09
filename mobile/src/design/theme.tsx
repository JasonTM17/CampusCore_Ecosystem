import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme, useWindowDimensions } from 'react-native';

import { defaultStorage } from '../i18n/locale-provider';
import type { KeyValueStorage } from '../i18n/locale';
import { tokens } from './tokens';
import { DEFAULT_THEME_PREFERENCE, loadThemePreference, resolveThemeScheme, saveThemePreference } from './theme-preference';
import type { ThemePreference } from './theme-preference';

export type { ThemePreference } from './theme-preference';

export type ThemeScheme = 'light' | 'dark';
export type ThemeColors = { [K in keyof typeof tokens.colors]: string };
export type RoleName = keyof typeof tokens.roleColors;
export type WindowClass = 'compact' | 'medium' | 'expanded';

export interface WindowInfo {
  class: WindowClass;
  width: number;
  height: number;
  landscape: boolean;
  fontScale: number;
}

export interface RoleColorPair {
  base: string;
  solid: string;
}

export interface Theme {
  scheme: ThemeScheme;
  /** Persisted choice; `system` follows the OS scheme. */
  preference: ThemePreference;
  /** Saves the choice and applies it immediately. */
  setPreference: (next: ThemePreference) => void;
  colors: ThemeColors;
  roleColors: Record<RoleName, RoleColorPair>;
  spacing: typeof tokens.spacing;
  radii: typeof tokens.radii;
  layout: typeof tokens.layout;
  typography: typeof tokens.typography;
  elevation: typeof tokens.elevation;
  motion: typeof tokens.motion;
  windowClasses: typeof tokens.windowClasses;
  reducedMotion: boolean;
  window: WindowInfo;
}

function rolePairs(scheme: ThemeScheme): Record<RoleName, RoleColorPair> {
  const out = {} as Record<RoleName, RoleColorPair>;
  for (const key of Object.keys(tokens.roleColors) as RoleName[]) {
    const entry = tokens.roleColors[key];
    out[key] = {
      base: scheme === 'dark' ? entry.dark : entry.light,
      solid: scheme === 'dark' ? entry.solidDark : entry.solid,
    };
  }
  return out;
}

function buildTheme(
  scheme: ThemeScheme,
  preference: ThemePreference,
  setPreference: (next: ThemePreference) => void,
  reducedMotion: boolean,
  window: WindowInfo,
): Theme {
  return {
    scheme,
    preference,
    setPreference,
    colors: scheme === 'dark' ? tokens.colorsDark : tokens.colors,
    roleColors: rolePairs(scheme),
    spacing: tokens.spacing,
    radii: tokens.radii,
    layout: tokens.layout,
    typography: tokens.typography,
    elevation: tokens.elevation,
    motion: tokens.motion,
    windowClasses: tokens.windowClasses,
    reducedMotion,
    window,
  };
}

const ThemeContext = createContext<Theme | undefined>(undefined);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Test/preview hook: pin a scheme instead of following the preference. */
  forcedScheme?: ThemeScheme;
  /** Test/preview hook: skip reading the saved preference. */
  initialPreference?: ThemePreference;
  /** Injectable storage; defaults to AsyncStorage. */
  storage?: KeyValueStorage;
}

const noopSetPreference = () => {};

export function ThemeProvider({ children, forcedScheme, initialPreference, storage }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference ?? DEFAULT_THEME_PREFERENCE);
  const store = useMemo(() => storage ?? defaultStorage(), [storage]);

  useEffect(() => {
    if (initialPreference !== undefined) return;
    let active = true;
    loadThemePreference(store).then((saved) => {
      if (!active) return;
      setPreferenceState(saved);
    });
    return () => {
      active = false;
    };
  }, [initialPreference, store]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      void saveThemePreference(store, next);
    },
    [store],
  );

  const scheme: ThemeScheme = forcedScheme ?? resolveThemeScheme(preference, systemScheme);
  const reducedMotion = useReducedMotion();
  const window = useWindowClass();
  const value = useMemo(
    () => buildTheme(scheme, preference, setPreference, reducedMotion, window),
    [scheme, preference, setPreference, reducedMotion, window],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Returns the active theme. Without a ThemeProvider it follows the system
 * scheme live and reports the implicit `system` preference.
 */
export function useTheme(): Theme {
  const provided = useContext(ThemeContext);
  const systemScheme = useColorScheme();
  const reducedMotion = useReducedMotion(provided === undefined);
  const window = useWindowClass();
  return useMemo(
    () => provided ?? buildTheme(
      resolveThemeScheme(DEFAULT_THEME_PREFERENCE, systemScheme),
      DEFAULT_THEME_PREFERENCE,
      noopSetPreference,
      reducedMotion,
      window,
    ),
    [provided, systemScheme, reducedMotion, window],
  );
}

export function useWindowClass(): WindowInfo {
  const { width, height, fontScale } = useWindowDimensions();
  const cls: WindowClass =
    width < tokens.windowClasses.compactMax
      ? 'compact'
      : width < tokens.windowClasses.mediumMax
        ? 'medium'
        : 'expanded';
  return { class: cls, width, height, landscape: width > height, fontScale };
}

let reducedMotionValue = false;
let reducedMotionGeneration = 0;
let reducedMotionSubscription: { remove(): void } | undefined;
const reducedMotionListeners = new Set<() => void>();
const noReducedMotionSubscription = () => () => {};

function updateReducedMotion(value: boolean) {
  if (reducedMotionValue === value) return;
  reducedMotionValue = value;
  for (const listener of reducedMotionListeners) listener();
}

function subscribeToReducedMotion(listener: () => void) {
  reducedMotionListeners.add(listener);
  if (!reducedMotionSubscription) {
    const queryGeneration = ++reducedMotionGeneration;
    reducedMotionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      reducedMotionGeneration += 1;
      updateReducedMotion(value);
    });
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (queryGeneration === reducedMotionGeneration) updateReducedMotion(value);
      })
      .catch(() => {});
  }
  return () => {
    reducedMotionListeners.delete(listener);
    if (reducedMotionListeners.size === 0) {
      reducedMotionGeneration += 1;
      reducedMotionSubscription?.remove();
      reducedMotionSubscription = undefined;
      reducedMotionValue = false;
    }
  };
}

export function useReducedMotion(enabled = true): boolean {
  return useSyncExternalStore(enabled ? subscribeToReducedMotion : noReducedMotionSubscription, () => reducedMotionValue, () => false);
}

export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}

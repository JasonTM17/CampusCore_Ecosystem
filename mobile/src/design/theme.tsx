import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme, useWindowDimensions } from 'react-native';

import { tokens } from './tokens';

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

function buildTheme(scheme: ThemeScheme, reducedMotion: boolean, window: WindowInfo): Theme {
  return {
    scheme,
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
  /** Test/preview hook: pin a scheme instead of following the system. */
  forcedScheme?: ThemeScheme;
}

export function ThemeProvider({ children, forcedScheme }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const scheme: ThemeScheme = forcedScheme ?? (systemScheme === 'dark' ? 'dark' : 'light');
  const reducedMotion = useReducedMotion();
  const window = useWindowClass();
  const value = useMemo(() => buildTheme(scheme, reducedMotion, window), [scheme, reducedMotion, window]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Returns the active theme. Without a ThemeProvider it follows the system
 * scheme live; the app is locked to light until M05 flips userInterfaceStyle.
 */
export function useTheme(): Theme {
  const provided = useContext(ThemeContext);
  const systemScheme = useColorScheme();
  const reducedMotion = useReducedMotion();
  const window = useWindowClass();
  return useMemo(
    () => provided ?? buildTheme(systemScheme === 'dark' ? 'dark' : 'light', reducedMotion, window),
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

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

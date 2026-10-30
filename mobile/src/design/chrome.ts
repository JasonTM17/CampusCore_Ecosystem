// Brand chrome (top bar, hero surfaces): the navy of the web portal sidebar.
// Mobile-only derivation of the web sidebar role; the shared token contract
// keeps its cool near-white canvas and blue primary unchanged.
import type { ThemeScheme } from './theme';

export interface ChromeColors {
  surface: string;
  surfaceStrong: string;
  onSurface: string;
  onSurfaceMuted: string;
  overlay: string;
  gold: string;
  onGold: string;
  accent: string;
  scrim: string;
}

const light: ChromeColors = {
  surface: '#00305E',
  surfaceStrong: '#001E40',
  onSurface: '#FFFFFF',
  onSurfaceMuted: '#C9D8F0',
  overlay: 'rgba(255,255,255,0.14)',
  gold: '#E3B662',
  onGold: '#2B1C00',
  accent: '#D1E8FA',
  scrim: 'rgba(9,22,40,0.58)',
};

const dark: ChromeColors = {
  surface: '#002148',
  surfaceStrong: '#00132F',
  onSurface: '#EDF0F2',
  onSurfaceMuted: '#A9B8CE',
  overlay: 'rgba(255,255,255,0.10)',
  gold: '#E9BD68',
  onGold: '#211500',
  accent: '#D1E8FA',
  scrim: 'rgba(5,12,24,0.70)',
};

export function chromeFor(scheme: ThemeScheme): ChromeColors {
  return scheme === 'dark' ? dark : light;
}

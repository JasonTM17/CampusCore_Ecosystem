// GENERATED from contracts/ecosystem/tokens.json — do not edit by hand.
// Regenerate: node scripts/sync-tokens.mjs (verify: --check).

import { Platform } from 'react-native';

const contract = {
  "$schema": "campusute/ecosystem-tokens@1",
  "version": 1,
  "source": "P03 — contracts/ecosystem; mobile + web consume this file, neither redefines values",
  "colors": {
    "background": "#F9F9FF",
    "surfaceLow": "#F1F5FB",
    "surface": "#E8EEF7",
    "surfaceHigh": "#DBE5F1",
    "card": "#FFFFFF",
    "text": "#17243A",
    "textMuted": "#526174",
    "primary": "#003F87",
    "primaryContainer": "#0056B3",
    "primaryFixed": "#E6F0FF",
    "secondary": "#455A73",
    "secondaryContainer": "#E9EFF7",
    "outline": "#61748D",
    "outlineVariant": "#C9D5E4",
    "accent": "#E5A900",
    "error": "#B42318",
    "success": "#247A4A",
    "warning": "#946200",
    "onPrimary": "#FFFFFF"
  },
  "spacing": {
    "unit": 4,
    "xs": 4,
    "sm": 8,
    "md": 16,
    "lg": 24,
    "xl": 32
  },
  "radii": {
    "control": 8,
    "card": 8,
    "pill": 999
  },
  "layout": {
    "mobileGutter": 16,
    "bottomNavigationHeight": 68,
    "touchTarget": 44
  },
  "typography": {
    "family": "BeVietnamPro_400Regular",
    "familyWeb": "Be Vietnam Pro",
    "fallback": "System",
    "display": {
      "fontSize": 34,
      "lineHeight": 40,
      "fontWeight": "700"
    },
    "headlineLarge": {
      "fontSize": 26,
      "lineHeight": 32,
      "fontWeight": "700"
    },
    "headlineMedium": {
      "fontSize": 22,
      "lineHeight": 28,
      "fontWeight": "700"
    },
    "headlineSmall": {
      "fontSize": 18,
      "lineHeight": 24,
      "fontWeight": "600"
    },
    "bodyLarge": {
      "fontSize": 17,
      "lineHeight": 26,
      "fontWeight": "400"
    },
    "bodyMedium": {
      "fontSize": 16,
      "lineHeight": 24,
      "fontWeight": "400"
    },
    "bodySmall": {
      "fontSize": 14,
      "lineHeight": 20,
      "fontWeight": "400"
    },
    "label": {
      "fontSize": 13,
      "lineHeight": 18,
      "fontWeight": "600"
    },
    "meta": {
      "fontSize": 12,
      "lineHeight": 16,
      "fontWeight": "600"
    }
  },
  "messages": {
    "loading": "ui.state.loading",
    "empty": "ui.state.empty",
    "error": "ui.state.error",
    "denied": "ui.state.denied",
    "offline": "ui.state.offline",
    "offlineReadWarning": "ui.state.offlineReadWarning",
    "retry": "ui.action.retry",
    "sessionExpired": "ui.session.expired"
  }
} as const;

export const tokens = {
  colors: contract.colors,
  spacing: contract.spacing,
  radii: contract.radii,
  layout: contract.layout,
  typography: {
    ...contract.typography,
    family: Platform.select({
      ios: contract.typography.family,
      android: contract.typography.family,
      default: contract.typography.family,
    }),
  },
} as const;

export const uiMessageKeys = contract.messages;

export type DesignTokens = typeof tokens;

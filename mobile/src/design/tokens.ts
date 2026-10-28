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
    "onPrimary": "#FFFFFF",
    "successFixed": "#DFF4E4",
    "warningFixed": "#FFF0C7",
    "errorFixed": "#FBDAD7"
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
    },
    "maxFontScale": 1.5
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
  },
  "colorsDark": {
    "background": "#13161B",
    "surfaceLow": "#15181E",
    "surface": "#23272E",
    "surfaceHigh": "#2B2F36",
    "card": "#1E2229",
    "text": "#EDF0F2",
    "textMuted": "#A9B1BC",
    "primary": "#98BDD7",
    "primaryContainer": "#1B5AA7",
    "primaryFixed": "#1C314A",
    "secondary": "#282C33",
    "secondaryContainer": "#363B45",
    "outline": "#C5C9CE",
    "outlineVariant": "#33363D",
    "accent": "#EB955C",
    "error": "#F49A9A",
    "success": "#9BD4BA",
    "warning": "#EED1A0",
    "onPrimary": "#12151C",
    "successFixed": "#203C2F",
    "warningFixed": "#433319",
    "errorFixed": "#431919"
  },
  "roleColors": {
    "student": {
      "light": "#1450D2",
      "dark": "#74B1FB",
      "solid": "#2463EB",
      "solidDark": "#2463EB"
    },
    "lecturer": {
      "light": "#186777",
      "dark": "#6AD2E7",
      "solid": "#148CA3",
      "solidDark": "#148CA3"
    },
    "admin": {
      "light": "#7B21CA",
      "dark": "#D087F7",
      "solid": "#9024F5",
      "solidDark": "#9024F5"
    },
    "superAdmin": {
      "light": "#B11B4D",
      "dark": "#F27DA4",
      "solid": "#D71D5B",
      "solidDark": "#D71D5B"
    }
  },
  "windowClasses": {
    "compactMax": 600,
    "mediumMax": 840
  },
  "elevation": {
    "none": 0,
    "low": 1,
    "medium": 2,
    "high": 3
  },
  "motion": {
    "durationShort": 150,
    "durationMedium": 300,
    "easing": "easeOutCubic"
  }
} as const;

export const tokens = {
  colors: contract.colors,
  colorsDark: contract.colorsDark,
  roleColors: contract.roleColors,
  windowClasses: contract.windowClasses,
  elevation: contract.elevation,
  motion: contract.motion,
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

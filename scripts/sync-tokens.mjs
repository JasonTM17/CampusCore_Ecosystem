#!/usr/bin/env node
/**
 * sync-tokens.mjs — P03 step 3.
 *
 * contracts/ecosystem/tokens.json is the single design-token source. This
 * script projects it into the two platform adapters:
 *   - mobile/src/design/tokens.ts      (RN tokens object, Platform.select font)
 *   - frontend/src/lib/design-tokens.ts (typed tokens + cssVar + ui message keys)
 *
 * `node scripts/sync-tokens.mjs` rewrites both adapters.
 * `node scripts/sync-tokens.mjs --check` byte-compares without writing.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(REPO, "contracts/ecosystem/tokens.json");
const TARGETS = {
  mobile: path.join(REPO, "mobile/src/design/tokens.ts"),
  frontend: path.join(REPO, "frontend/src/lib/design-tokens.ts"),
};

const tokens = JSON.parse(readFileSync(SOURCE, "utf8"));
const check = process.argv.includes("--check");

const HEADER = `// GENERATED from contracts/ecosystem/tokens.json — do not edit by hand.
// Regenerate: node scripts/sync-tokens.mjs (verify: --check).
`;

function renderMobile() {
  return `${HEADER}
import { Platform } from 'react-native';

const contract = ${JSON.stringify(tokens, null, 2)} as const;

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
`;
}

function renderFrontend() {
  return `${HEADER}

const contract = ${JSON.stringify(tokens, null, 2)} as const;

// Web consumers get the CSS font family (familyWeb); the React Native asset
// name is never exposed through the web adapter.
export const designTokens = {
  ...contract,
  typography: { ...contract.typography, family: contract.typography.familyWeb },
} as const;
export type DesignTokens = typeof designTokens;

/** Canonical UI message keys shared across web/native surfaces (P03). */
export const uiMessageKeys = contract.messages;

const cssVarNames = {
  background: '--background',
  card: '--card',
  text: '--foreground',
  textMuted: '--muted-foreground',
  primary: '--primary',
  secondary: '--secondary',
  accent: '--accent-cool',
  error: '--destructive',
  success: '--success',
  warning: '--status-warning',
} as const;

/** Resolve a shared color token to the themed CSS variable when one exists. */
export function cssVar(token: keyof typeof cssVarNames): string {
  return \`hsl(var(\${cssVarNames[token]}))\`;
}
`;
}

const outputs = { mobile: renderMobile(), frontend: renderFrontend() };
const problems = [];

for (const [name, content] of Object.entries(outputs)) {
  const file = TARGETS[name];
  if (check) {
    if (!existsSync(file)) {
      problems.push(`${name} adapter missing: ${path.relative(REPO, file)}`);
    } else if (readFileSync(file, "utf8") !== content) {
      problems.push(`${name} adapter drift: ${path.relative(REPO, file)} (run sync-tokens.mjs)`);
    }
  } else {
    writeFileSync(file, content, "utf8");
    console.log(`wrote ${path.relative(REPO, file)}`);
  }
}

if (problems.length) {
  console.log(JSON.stringify({ verdict: "FAIL", problems }, null, 2));
  process.exit(1);
}
if (check) console.log(JSON.stringify({ verdict: "PASS", adapters: "byte-equal" }));

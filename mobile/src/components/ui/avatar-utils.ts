// Pure avatar helpers: initials, deterministic tone assignment, sizes and
// colour math. No React or native imports so `node --test` can exercise this
// module directly (see tests/avatar-identity.test.mjs).

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Identity sizes track the web steps (assistant 28, rows 32, shell 36, profile 80). */
export const AVATAR_SIZES: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
};

export function resolveAvatarSize(size: AvatarSize | number | undefined): number {
  if (size === undefined) return AVATAR_SIZES.md;
  return typeof size === 'number' ? size : AVATAR_SIZES[size];
}

/** Initials scale with the circle instead of jumping between text variants. */
export function avatarFontSize(px: number): number {
  return Math.max(9, Math.round(px * 0.36));
}

const LETTER = /\p{L}/u;

function firstLetter(word: string | undefined): string {
  if (!word) return '';
  for (const ch of word) {
    if (LETTER.test(ch)) return ch;
  }
  return '';
}

/**
 * Deterministic initials for Vietnamese names: the given name (last word)
 * leads, the family name (first word) follows — "Nguyễn Đức Minh" → "MN".
 * Diacritics are preserved; punctuation, digits and emoji never render.
 */
export function initialsFor(name: string | null | undefined, fallbackLabel?: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    const label = firstLetter((fallbackLabel ?? '').trim());
    return (label || '?').toUpperCase();
  }
  const given = firstLetter(parts[parts.length - 1]);
  const family = parts.length > 1 ? firstLetter(parts[0]) : '';
  const out = `${given}${family && family !== given ? family : ''}`;
  return out ? out.toUpperCase() : '?';
}

/** Stable across locales and sessions; insensitive to composed/decomposed input. */
export function hashName(name: string): number {
  let h = 5381;
  for (const ch of name.normalize('NFC')) {
    h = ((h * 33) ^ (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return h >>> 0;
}

export function avatarToneIndex(name: string, count: number): number {
  return count > 0 ? hashName(name) % count : 0;
}

/**
 * Palette slots resolve against theme tokens in avatar.tsx. Plain keys read
 * `colors[key]`; `role.*` keys read `roleColors[role].base` (scheme-aware).
 * Every slot is verified >= 4.5:1 against the scheme's onPrimary ink in
 * tests/avatar-identity.test.mjs — never colour by gender or ethnicity.
 */
export type AvatarToneKey =
  | 'primary'
  | 'primaryContainer'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'role.student'
  | 'role.lecturer'
  | 'role.admin'
  | 'role.superAdmin';

export const AVATAR_PALETTE_LIGHT: readonly AvatarToneKey[] = [
  'primary',
  'primaryContainer',
  'secondary',
  'success',
  'role.student',
  'role.admin',
];

export const AVATAR_PALETTE_DARK: readonly AvatarToneKey[] = [
  'primary',
  'role.student',
  'role.lecturer',
  'success',
  'role.admin',
  'warning',
];

/** '#RRGGBB' → 'rgba(r,g,b,a)'; passes through anything else unchanged. */
export function alpha(hex: string, opacity: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

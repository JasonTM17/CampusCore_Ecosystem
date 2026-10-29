import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { loadTs } from './helpers/load-ts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokens = JSON.parse(readFileSync(path.join(ROOT, 'contracts/ecosystem/tokens.json'), 'utf8'));

const {
  AVATAR_PALETTE_DARK,
  AVATAR_PALETTE_LIGHT,
  AVATAR_SIZES,
  alpha,
  avatarFontSize,
  avatarToneIndex,
  initialsFor,
  resolveAvatarSize,
} = await loadTs('../mobile/src/components/ui/avatar-utils.ts');

function lum(hex) {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => f(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Resolve a palette slot to its background hex in the given scheme, like avatar.tsx. */
function toneBg(key, scheme) {
  if (key.startsWith('role.')) {
    const role = key.slice(5);
    return tokens.roleColors[role][scheme === 'dark' ? 'dark' : 'light'];
  }
  return (scheme === 'dark' ? tokens.colorsDark : tokens.colors)[key];
}
function toneInk(scheme) {
  return (scheme === 'dark' ? tokens.colorsDark : tokens.colors).onPrimary;
}

describe('initialsFor', () => {
  it('uses the given name (last word) first, then the family letter', () => {
    assert.equal(initialsFor('Nguyễn Đức Minh'), 'MN');
    assert.equal(initialsFor('Phạm Anh Thư'), 'TP');
    assert.equal(initialsFor('Nguyen Van A'), 'AN');
  });

  it('keeps diacritics and uppercases them', () => {
    assert.equal(initialsFor('Đỗ Quang Huy'), 'HĐ');
    assert.equal(initialsFor('vũ đình dũng'), 'DV');
    assert.equal(initialsFor('Trần Thị Ước'), 'ƯT');
  });

  it('handles single-word, empty and whitespace names', () => {
    assert.equal(initialsFor('Minh'), 'M');
    assert.equal(initialsFor(''), '?');
    assert.equal(initialsFor('   '), '?');
    assert.equal(initialsFor(null), '?');
    assert.equal(initialsFor(undefined), '?');
  });

  it('collapses to the surviving letter when both initials match', () => {
    assert.equal(initialsFor('Nguyễn Nguyễn'), 'N');
  });

  it('never returns emoji or punctuation', () => {
    assert.equal(initialsFor('😀😀'), '?');
    assert.equal(initialsFor('🔥 Minh'), 'M');
    assert.equal(initialsFor('-Nguyễn -Minh'), 'MN');
    assert.equal(initialsFor('123'), '?');
  });

  it('handles long names via first and last word only', () => {
    assert.equal(initialsFor('Nguyễn Văn Đức Minh'), 'MN');
  });

  it('falls back to a label when no name exists', () => {
    assert.equal(initialsFor('', 'ute'), 'U');
    assert.equal(initialsFor(null, '?'), '?');
  });
});

describe('avatarToneIndex', () => {
  it('is deterministic and stable across composed/decomposed input', () => {
    const a = avatarToneIndex('Nguyễn Đức Minh', 6);
    assert.equal(a, avatarToneIndex('Nguyễn Đức Minh', 6));
    assert.equal(
      avatarToneIndex('Nguyễn'.normalize('NFC'), 6),
      avatarToneIndex('Nguyễn'.normalize('NFD'), 6),
    );
    assert.ok(a >= 0 && a < 6);
  });

  it('spreads different names over more than one slot', () => {
    const names = ['Nguyễn Đức Minh', 'Phạm Anh Thư', 'Lê Khánh Vy', 'Trần Hoàng Nam', 'Đỗ Quang Huy', 'Vũ Đình Dũng', 'Bùi Thu Hà', 'Hoàng Gia Bảo'];
    const slots = new Set(names.map((n) => avatarToneIndex(n, 6)));
    assert.ok(slots.size >= 3, `expected palette spread, got slots ${[...slots].join(',')}`);
  });
});

describe('avatar palette contrast', () => {
  for (const [scheme, palette] of [['light', AVATAR_PALETTE_LIGHT], ['dark', AVATAR_PALETTE_DARK]]) {
    it(`${scheme}: every tone keeps initials at >= 4.5:1`, () => {
      const ink = toneInk(scheme);
      assert.ok(palette.length >= 4, 'palette needs several tones');
      for (const key of palette) {
        const bg = toneBg(key, scheme);
        const r = ratio(ink, bg);
        assert.ok(r >= 4.5, `${scheme}: ${key} ink ${ink} on ${bg} = ${r.toFixed(2)} < 4.5`);
      }
    });
  }
});

describe('size and colour helpers', () => {
  it('maps named sizes and passes numbers through', () => {
    assert.equal(resolveAvatarSize('sm'), AVATAR_SIZES.sm);
    assert.equal(resolveAvatarSize('xl'), AVATAR_SIZES.xl);
    assert.equal(resolveAvatarSize(undefined), AVATAR_SIZES.md);
    assert.equal(resolveAvatarSize(48), 48);
  });

  it('scales initials with the circle', () => {
    assert.ok(avatarFontSize(32) < avatarFontSize(80));
    assert.ok(avatarFontSize(24) >= 9);
  });

  it('mixes token hex into rgba', () => {
    assert.equal(alpha('#003F87', 0.3), 'rgba(0,63,135,0.3)');
    assert.equal(alpha('#FFFFFF', 0.14), 'rgba(255,255,255,0.14)');
    assert.equal(alpha('rgba(1,2,3,0.5)', 0.3), 'rgba(1,2,3,0.5)');
  });
});

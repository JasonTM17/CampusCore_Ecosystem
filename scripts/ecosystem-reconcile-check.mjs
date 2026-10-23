#!/usr/bin/env node
/**
 * P14 source/docs reconcile leg (static): proves the doc surface and the
 * code surface still agree before a candidate manifest binds them —
 * every gate id cited in docs exists in the manifest, i18n locales stay
 * key-parity, seed-file email literals stay inside the declared
 * synthetic allowlist, and the classes the identity contract names
 * actually exist.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── 1. every `--gate <id>` / `gate <id>` doc citation resolves ────────
const gates = JSON.parse(read('scripts/verify-ecosystem.gates.json'));
const docFiles = fs.readdirSync(path.join(root, 'docs/ecosystem'))
  .filter((f) => f.endsWith('.md'));
const cited = new Set();
for (const f of docFiles) {
  for (const m of read(`docs/ecosystem/${f}`).matchAll(/--gate[\s=]+([a-z0-9-]+)|gate `([a-z0-9-]+)`/g)) {
    cited.add(m[1] ?? m[2]);
  }
}
for (const id of cited) {
  assert.ok(gates.gates[id], `docs cite gate ${id} but it is not registered`);
}

// ── 2. vi/en key parity per i18n message file ──────────────────────────
// locale object → key set (handles `vi:`, `"vi":`, `'vi':` decl styles and
// hyphenated/dotted keys). A *-messages.ts file that yields no vi/en pair
// is drift, not a skip — silence would mask a renamed locale block.
function localeKeys(source, locale) {
  const m = source.match(new RegExp(`["']?${locale}["']?\\s*:\\s*\\{`));
  if (!m) return null;
  let depth = 1; let i = m.index + m[0].length;
  const start = i;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') depth -= 1;
    i += 1;
  }
  const body = source.slice(start, i - 1);
  return new Set([...body.matchAll(/\n\s*['"]?([a-zA-Z0-9_.-]+)['"]?\s*:/g)].map((k) => k[1]));
}
const i18nDirs = ['mobile/src/i18n', 'frontend/src/i18n'];
let i18nFiles = 0;
const i18nSkipped = [];
for (const dir of i18nDirs) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('-messages.ts')) continue;
    const src = read(`${dir}/${f}`);
    const vi = localeKeys(src, 'vi');
    const en = localeKeys(src, 'en');
    if (!vi || !en) { i18nSkipped.push(`${dir}/${f}`); continue; }
    i18nFiles += 1;
    assert.deepEqual([...vi].sort(), [...en].sort(), `${dir}/${f} vi/en key drift`);
  }
}
assert.equal(i18nSkipped.length, 0, `locale maps without a vi/en pair: ${i18nSkipped.join(', ')}`);
assert.ok(i18nFiles >= 5, `expected >=5 i18n locale maps, found ${i18nFiles}`);

// ── 3. seed-file email literals inside the synthetic allowlist ─────────
// Seeds build addresses via concat too ('student'||lpad()||'@x.demo'), so
// check every @domain fragment inside every quoted literal — not only
// literals that happen to be a complete address.
const ALLOWED_DOMAINS = ['@campuscore.demo', '@campuscore.edu', '@campuscore.test', '@ute.demo.edu.vn'];
const migDir = 'java-services/restful-api/src/main/resources/db/migration';
for (const f of fs.readdirSync(path.join(root, migDir)).filter((f) => f.endsWith('.sql'))) {
  const src = read(`${migDir}/${f}`);
  for (const m of src.matchAll(/'([^']*@[^']*)'/g)) {
    const literal = m[1];
    // '%…@…%' is a LIKE/ILIKE pattern (e.g. V131 purging probe rows), never
    // an address being stored — only value literals can seed an email.
    if (/^%.*%$/.test(literal)) continue;
    // Literals containing whitespace are prose (knowledge text may quote
    // the university's real mail format) — they cannot be an address
    // value or a concat fragment; only space-free literals can.
    if (/\s/.test(literal)) continue;
    // Domain must contain a dot — @Valid/@Service inside quoted knowledge
    // text are Java annotations, not email domains.
    for (const dm of literal.matchAll(/@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      const domain = `@${dm[1].toLowerCase()}`;
      assert.ok(
        ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d.slice(1)}`)),
        `${f} seeds non-synthetic email domain ${domain} (policy §2 allowlist)`,
      );
    }
  }
}

// ── 4. classes named by the identity contract actually exist ──────────
const javaRoot = 'java-services/restful-api/src/main/java';
for (const cls of ['IdentityGrantRetentionJob', 'SessionCookieService', 'CsrfCookieFilter', 'CookieOrBearerTokenResolver']) {
  const found = (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && walk(full)) return true;
      if (e.name === `${cls}.java`) return true;
    }
    return false;
  })(path.join(root, javaRoot));
  assert.ok(found, `identity-contract names ${cls} but no ${cls}.java exists`);
}

console.log(JSON.stringify({ verdict: 'PASS', gatesCited: [...cited], i18nFiles, emailDomains: ALLOWED_DOMAINS }, null, 2));

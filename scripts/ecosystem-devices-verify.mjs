#!/usr/bin/env node
/**
 * P13 `devices` association-contract leg (static): proves the universal/
 * app-link documents exist, carry only permitted identifiers, and that
 * the host + path policy excludes auth callbacks and API lanes. Device/
 * signing evidence is an external capability — this leg verifies the
 * committed contract, not a device run.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const aasa = JSON.parse(read('frontend/public/.well-known/apple-app-site-association'));
const assetlinks = JSON.parse(read('frontend/public/.well-known/assetlinks.json'));
const appJson = JSON.parse(read('mobile/app.json'));
const routeMap = read('mobile/src/navigation/route-map.ts');

// Claimed lanes: exact portal paths that resolve to a native screen.
// Detail permalinks stay in the browser (no detail-param resolution);
// /events + /learning exist only as app-internal paths — no portal
// root route — so they are never claimed.
const LANES = ['/news', '/docs', '/careers', '/library', '/apply'];
const FORBIDDEN = ['/session', '/api'];
const SYNTH_APPID = /^SYNTH[A-Z0-9]+\.io\.campuscore\.mobile$/;
const ZERO_FP = /^00(:00)+$/;

// Every committed identifier must be the synthetic placeholder — a real
// TeamID or fingerprint anywhere in the file is a policy violation.
function assertSyntheticIds(ids, where) {
  for (const id of ids ?? []) {
    assert.match(id, SYNTH_APPID, `${where} carries non-synthetic id ${id} — real identifiers come from the secret store`);
  }
}

// ── iOS AASA ──────────────────────────────────────────────────────────
const details = aasa.applinks?.details ?? [];
assert.ok(details.length > 0, 'AASA applinks.details missing');
const appIds = details.flatMap((entry) => [...(entry.appIDs ?? []), ...(entry.appID ? [entry.appID] : [])]);
assert.ok(appIds.length > 0, 'AASA carries no appIDs');
assertSyntheticIds(appIds, 'applinks.details');
assertSyntheticIds(aasa.applinks?.apps, 'applinks.apps (legacy)');

// Every other identifier-bearing surface must be absent or empty —
// webcredentials/appclips/activitycontinuation are not swept by
// details[].appIDs and could smuggle a real TeamID past this check.
for (const [key, value] of [
  ['webcredentials.apps', aasa.webcredentials?.apps],
  ['appclips.apps', aasa.appclips?.apps],
  ['activitycontinuation.apps', aasa.activitycontinuation?.apps],
]) {
  assertSyntheticIds(value, key);
}

const components = details.flatMap((entry) => entry.components ?? []);
const excludes = components.filter((c) => c.exclude).map((c) => c['/']);
for (const prefix of FORBIDDEN) {
  assert.ok(
    excludes.some((p) => p.startsWith(prefix)),
    `AASA must exclude ${prefix}/* (auth loop + non-app lanes)`,
  );
}
const included = components.filter((c) => !c.exclude).map((c) => c['/']);
assert.deepEqual(
  [...included].sort(), [...LANES].sort(),
  `AASA claimed lanes drifted — claim exactly ${LANES.join(', ')} (portal routes with a native screen)`,
);

// ── Android assetlinks: every entry targeting our package is swept ────
const targets = assetlinks.filter((entry) => entry.target?.package_name === 'io.campuscore.mobile');
assert.ok(targets.length > 0, 'assetlinks missing io.campuscore.mobile target');
for (const [i, link] of targets.entries()) {
  for (const fp of link.target.sha256_cert_fingerprints ?? []) {
    assert.match(fp, ZERO_FP, `assetlinks[${i}] carries a non-synthetic fingerprint — real value comes from the secret store`);
  }
}

// ── App declaration: associated domains + autoVerify intent filters ───
assert.deepEqual(appJson.expo.ios.associatedDomains, ['applinks:www.campusute.io.vn']);
const filters = appJson.expo.android.intentFilters ?? [];
const verified = filters.filter((f) => f.autoVerify === true);
assert.ok(verified.length > 0, 'android intentFilters missing autoVerify entries');
const claimedPaths = [];
for (const f of verified) {
  for (const d of f.data ?? []) {
    assert.equal(d.host, 'www.campusute.io.vn', `autoVerify host drift: ${d.host}`);
    const pathKeys = ['path', 'pathPrefix', 'pathPattern', 'pathSuffix'].filter((k) => typeof d[k] === 'string');
    // A host-only entry would verify-claim every path on the portal —
    // including /session/callback — recreating the auth loop the AASA
    // excludes forbid.
    assert.ok(pathKeys.length > 0, `autoVerify data entry has no path bound (host-only claim): ${JSON.stringify(d)}`);
    const value = d[pathKeys[0]];
    assert.ok(
      LANES.includes(value),
      `autoVerify claims unapproved path ${value} — lanes are exactly ${LANES.join(', ')}`,
    );
    assert.ok(
      !FORBIDDEN.some((p) => value.startsWith(p)),
      `autoVerify claims a forbidden lane ${value}`,
    );
    claimedPaths.push(value);
  }
}
assert.deepEqual([...claimedPaths].sort(), [...LANES].sort(), 'android claim set must mirror the AASA lanes');

// ── Claim → screen parity: every claimed lane resolves via pathByScreen
for (const lane of LANES) {
  assert.match(routeMap, new RegExp(`: '${lane}'`), `claimed lane ${lane} has no pathByScreen entry`);
}

// Auth callback still consumed by the OIDC lane, never routed as a screen.
assert.match(routeMap, /auth\/callback.*ABSENT|auth\.callback/s, 'callback exclusion doc drifted');

console.log(JSON.stringify({
  verdict: 'PASS',
  appIds,
  excludes,
  lanes: included,
  androidPaths: claimedPaths,
  host: 'www.campusute.io.vn',
}, null, 2));

#!/usr/bin/env node
// host-registry gate (P05, R2-1): the browser-surface registry has three
// projections that must stay consistent — docs/ecosystem/host-policy.md §1
// (contract table), frontend/src/lib/surfaces.ts (edge projection), and the
// Java wiring that consumes identity.bff.surfaces[]. Exits nonzero on any
// drift; prints each invariant as PASS/FAIL with the offending detail.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = path.join(REPO, 'docs/ecosystem/host-policy.md');
const PROJECTION = path.join(REPO, 'frontend/src/lib/surfaces.ts');
const BFF_DIR = path.join(REPO, 'java-services/restful-api/src/main/java/io/campuscore/restfulapi/identity/bff');
const IDENTITY_DIR = path.join(REPO, 'java-services/restful-api/src/main/java/io/campuscore/restfulapi/identity');
const PG_MIGRATION = path.join(REPO, 'java-services/restful-api/src/main/resources/db/migration/V135__bff_session_isolation.sql');
const H2_MIGRATION = path.join(REPO, 'java-services/restful-api/src/test/resources/db/migration-h2/V135__bff_session_isolation.sql');

const results = [];
function check(id, ok, detail = '') {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` — ${detail}` : ''}`);
}
function read(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

// ---- contract table from host-policy.md §1 ------------------------------
// Rows look like: | `portal` | `www.campusute.io.vn` | `portal.localhost` | BFF | `cu-portal` |
const doc = read(DOC);
const rowRe = /\|\s*`(\w+)`\s*\|\s*`([\w.-]+)`\s*\|\s*`([\w.-]+)`\s*\|\s*([^|]+)\|\s*([^|]*)\|/g;
const docSurfaces = [];
let m;
while ((m = rowRe.exec(doc)) !== null) {
  docSurfaces.push({
    id: m[1], host: m[2], devHost: m[3],
    mode: m[4].trim(), client: m[5].replace(/`/g, '').trim() || null,
  });
}
check('doc-registry-7-surfaces', docSurfaces.length === 7,
  `expected 7 canonical surfaces, found ${docSurfaces.length}`);
const docIds = new Set(docSurfaces.map((s) => s.id));
for (const id of ['apex', 'portal', 'learn', 'apply', 'news', 'docs', 'identity']) {
  check(`doc-surface-${id}`, docIds.has(id));
}

// unique host bindings across the table (prod + dev)
const allHosts = docSurfaces.flatMap((s) => [s.host, s.devHost]);
check('doc-unique-hosts', new Set(allHosts).size === allHosts.length,
  `${allHosts.length} bindings, ${new Set(allHosts).size} unique`);

// mode↔client coherence: BFF needs a client id; others must not carry one
const clientRe = /^cu-\w+$/;
for (const s of docSurfaces) {
  const wantsClient = /BFF/i.test(s.mode);
  const hasClient = s.client !== null && clientRe.test(s.client);
  check(`doc-client-${s.id}`, wantsClient === hasClient,
    `mode="${s.mode}" client=${s.client ?? '—'}`);
}

// ---- frontend projection parity ------------------------------------------
const proj = read(PROJECTION);
check('projection-exists', proj.length > 0, 'frontend/src/lib/surfaces.ts');
for (const s of docSurfaces) {
  const idOk = proj.includes(`id: '${s.id}'`);
  const hostOk = proj.includes(`host: '${s.host}'`);
  const devOk = proj.includes(`devHost: '${s.devHost}'`);
  check(`projection-${s.id}`, idOk && hostOk && devOk,
    `id:${idOk} host:${hostOk} devHost:${devOk}`);
}

// ---- Java-side wiring ------------------------------------------------------
const controller = read(path.join(BFF_DIR, 'BffSessionController.java'));
for (const literal of ['__Host-cu_session', 'cu_session_dev', 'cu_bff_tx_', 'cu_bff_tx_dev_']) {
  check(`java-cookie-${literal}`, controller.includes(`"${literal}"`));
}
const registry = read(path.join(BFF_DIR, 'BffSurfaceRegistry.java')).toLowerCase();
for (const header of ['x-campuscore-surface', 'x-campuscore-scheme', 'x-campuscore-host', 'x-campuscore-proxy-token']) {
  check(`java-header-${header}`, registry.includes(header));
}
const security = read(path.join(IDENTITY_DIR, 'IdentitySecurityConfig.java'));
check('java-surface-clients-registered',
  security.includes('getSurfaces()') && security.includes('getClientId()'),
  'IdentitySecurityConfig must build RegisteredClient per BFF surface');
const proxyAuth = read(path.join(BFF_DIR, 'BffProxyAuthFilter.java'));
check('java-proxy-secret-pair-check',
  /x-campuscore-bff-secret/i.test(proxyAuth) && proxyAuth.includes('getProxySecret()'),
  'BffProxyAuthFilter must validate the surface↔secret pair');

// ---- migration parity --------------------------------------------------------
const pg = read(PG_MIGRATION);
const h2 = read(H2_MIGRATION);
check('migration-pg-exists', pg.length > 0);
check('migration-h2-mirror-exists', h2.length > 0);
for (const column of ['client_id', 'csrf_ciphertext', 'tx_id', 'bff_session', 'bff_transaction']) {
  check(`migration-column-${column}`, pg.includes(column));
}
for (const column of ['client_id', 'csrf_ciphertext', 'tx_id']) {
  check(`migration-h2-column-${column}`, h2.includes(column));
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`host-registry FAIL: ${failed.length}/${results.length} invariant(s) drifted`);
  process.exit(1);
}
console.log(`host-registry PASS: ${results.length} invariants`);

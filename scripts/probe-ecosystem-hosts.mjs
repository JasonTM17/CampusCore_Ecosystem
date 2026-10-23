#!/usr/bin/env node
/**
 * P14 host probe: TLS/cache/redirect/CSP/association checks against a
 * live surface set. Runs against any environment — preview dev hosts,
 * the disposable compose stack, or the declared demo hostname.
 *
 *   node scripts/probe-ecosystem-hosts.mjs \
 *     --host portal=https://portal.localhost:3102 \
 *     --host apex=https://apex.localhost:3102 \
 *     --host api=https://id.localhost:4443 \
 *     --insecure [--json out.json]
 *
 * Per-host case table is keyed by surface role; unknown roles get the
 * generic checks (reachable + CSP).
 */
import assert from 'node:assert/strict';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const insecure = args.includes('--insecure') || process.env.ECO_PROBE_INSECURE === '1';
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? path.resolve(root, args[jsonIdx + 1]) : null;
const hosts = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--host' && args[i + 1]) {
    const [role, base] = args[i + 1].split('=');
    hosts.push({ role, base: base.replace(/\/+$/, '') });
    i += 1;
  }
}
// Env fallback: ECO_PROBE_HOST_<ROLE>=<base-url> supplies hosts when no
// --host flag is given (the gate case wires env, not args).
if (hosts.length === 0) {
  for (const [key, base] of Object.entries(process.env)) {
    const m = /^ECO_PROBE_HOST_([A-Z_]+)$/.exec(key);
    if (m && base) hosts.push({ role: m[1].toLowerCase(), base: base.replace(/\/+$/, '') });
  }
}
if (hosts.length === 0) { console.error('no --host role=url pairs'); process.exit(2); }
if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const SYNTH_APPID = /^SYNTH[A-Z0-9]+\.io\.campuscore\.mobile$/;
const results = [];
const check = (role, name, ok, detail) => {
  results.push({ role, check: name, status: ok ? 'PASS' : 'FAIL', detail });
  if (!ok) console.error(`FAIL ${role}/${name}: ${detail}`);
};

// *.localhost is a browser-level resolver convention — Node needs the
// same map or every probe dies at DNS. The lookup override keeps SNI +
// Host headers on the real hostname while dialing 127.0.0.1.
const localLookup = (hostname, opts, cb) => {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return opts && opts.all
      ? cb(null, [{ address: '127.0.0.1', family: 4 }])
      : cb(null, '127.0.0.1', 4);
  }
  return dns.lookup(hostname, opts, cb);
};

function get(url) {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`, method: 'GET',
      lookup: localLookup, rejectUnauthorized: !insecure,
      headers: { 'user-agent': 'ecosystem-host-probe' },
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

for (const { role, base } of hosts) {
  try {
    if (role === 'portal' || role === 'learn' || role === 'apply') {
      // Association files: right type, synthetic identifiers, excludes.
      const aasa = await get(`${base}/.well-known/apple-app-site-association`);
      check(role, 'aasa-status', aasa.status === 200, `status ${aasa.status}`);
      check(role, 'aasa-content-type', /application\/json/.test(aasa.headers['content-type'] ?? ''), String(aasa.headers['content-type']));
      const parsed = JSON.parse(aasa.body);
      const ids = (parsed.applinks?.details ?? []).flatMap((d) => d.appIDs ?? []);
      check(role, 'aasa-synthetic', ids.length > 0 && ids.every((i) => SYNTH_APPID.test(i)), ids.join(',') || 'no appIDs');
      const excl = (parsed.applinks?.details ?? []).flatMap((d) => d.components ?? []).filter((c) => c.exclude).map((c) => c['/']);
      check(role, 'aasa-excludes', excl.some((p) => p.startsWith('/session')) && excl.some((p) => p.startsWith('/api')), excl.join(','));

      const links = await get(`${base}/.well-known/assetlinks.json`);
      check(role, 'assetlinks-status', links.status === 200, `status ${links.status}`);
      const fps = JSON.parse(links.body).filter((e) => e.target?.package_name === 'io.campuscore.mobile')
        .flatMap((e) => e.target.sha256_cert_fingerprints ?? []);
      check(role, 'assetlinks-synthetic', fps.length > 0 && fps.every((f) => /^00(:00)+$/.test(f)), fps.join(','));

      // CSP + private-response cache posture on a surface page.
      const home = await get(`${base}/`);
      check(role, 'home-status', home.status === 200, `status ${home.status}`);
      const csp = home.headers['content-security-policy'] ?? '';
      check(role, 'csp', csp.length > 0, `content-security-policy=${csp.length > 0 ? `${csp.length}ch` : 'absent'}`);

      // Session lane never caches — a missing endpoint (404) is a
      // fabricated-surface tell, not a pass.
      const session = await get(`${base}/session/state`);
      check(role, 'session-nostore', /no-store|no-cache/.test(session.headers['cache-control'] ?? '') || [401, 403].includes(session.status),
        `cache-control=${session.headers['cache-control']} status=${session.status}`);
    } else if (role === 'apex') {
      const res = await get(`${base}/`);
      check(role, 'apex-redirect', [301, 302, 307, 308].includes(res.status), `status ${res.status}`);
      const loc = res.headers['location'] ?? '';
      // The redirect must land on the probed portal host, not merely
      // contain the substring "portal." anywhere.
      const portalHost = hosts.find((h) => h.role === 'portal');
      const locHost = (() => { try { return new URL(loc).hostname; } catch { return ''; } })();
      check(role, 'apex-target', !!portalHost && locHost === new URL(portalHost.base).hostname, `location=${loc}`);
    } else if (role === 'id' || role === 'api') {
      const health = await get(`${base}/api/v1/health/liveness`);
      check(role, 'liveness', health.status === 200, `status ${health.status}`);
      const rid = health.headers['x-request-id'] ?? '';
      check(role, 'request-id', rid.length > 0, `x-request-id=${rid.length > 0 ? 'present' : 'absent'}`);
    } else {
      // Unknown role: generic surface posture — reachable + CSP.
      const home = await get(`${base}/`);
      check(role, 'home-status', home.status === 200, `status ${home.status}`);
      const csp = home.headers['content-security-policy'] ?? '';
      check(role, 'csp', csp.length > 0, `content-security-policy=${csp.length > 0 ? `${csp.length}ch` : 'absent'}`);
    }
  } catch (err) {
    results.push({ role, check: 'reachable', status: 'FAIL', detail: String(err).slice(0, 300) });
  }
}

const failed = results.filter((r) => r.status === 'FAIL');
const verdict = results.length === 0 ? 'NOT_RUN' : failed.length === 0 ? 'PASS' : 'FAIL';
const report = {
  verdict, checks: results.length, failed: failed.length,
  roles: hosts.map((h) => h.role),
  tlsVerified: !insecure,
  results,
};
console.log(JSON.stringify(report, null, 2));
if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n'); }
process.exit(verdict === 'PASS' ? 0 : verdict === 'NOT_RUN' ? 2 : 1);

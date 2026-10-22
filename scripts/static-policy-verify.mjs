#!/usr/bin/env node
// static-policy gate (P05, R2-1): sentinel scan over identity/bff enforcing
// the cookie/CSRF/token-leak invariants of docs/ecosystem/host-policy.md
// §2/§4/§5. Forbidden literals fail; required defenses must be present.
// This is a drift tripwire, not a proof — the live contract tests carry the
// behavioral evidence.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BFF_DIR = path.join(REPO, 'java-services/restful-api/src/main/java/io/campuscore/restfulapi/identity/bff');

const results = [];
function check(id, ok, detail = '') {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` — ${detail}` : ''}`);
}
function read(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

const files = existsSync(BFF_DIR)
  ? readdirSync(BFF_DIR).filter((f) => f.endsWith('.java'))
  : [];
const sources = new Map(files.map((f) => [f, read(path.join(BFF_DIR, f))]));
const all = [...sources.values()].join('\n');
check('bff-package-present', files.length >= 7, `${files.length} java files`);

// ---- forbidden literals ----------------------------------------------------
const forbidden = [
  // §2: no Domain attribute ever — host-only cookies.
  [/;\s*Domain\s*=/i, 'cookie-domain-attr'],
  [/SameSite\s*[=:]\s*["']?None/i, 'samesite-none'],
  // Tokens must never be serialized to the browser: no response keys that
  // would carry OAuth material out of a controller body.
  [/body\.put\(\s*"(accessToken|refreshToken|idToken|id_token|access_token|refresh_token)"/,
    'token-key-in-response'],
  [/"(accessToken|refreshToken|idToken)"\s*,\s*tokens\./, 'token-field-in-json'],
  // No DB lock may wrap the loopback token call: FOR UPDATE on bff_session
  // while a synchronous RestClient call is in flight would self-deadlock
  // against SAS's own lockUserRow.
  [/for update[\s\S]{0,400}tokens\.(refresh|exchangeCode)/i, 'db-lock-across-loopback'],
];
for (const [re, name] of forbidden) {
  check(`forbidden-${name}`, !re.test(all));
}

// ---- required defenses -------------------------------------------------------
const controller = sources.get('BffSessionController.java') ?? '';
check('controller-nostore', /no-store/.test(controller));
check('controller-host-cookie', controller.includes('__Host-cu_session'));
check('controller-secure-cookie', /"Secure"/.test(controller) || /\.secure\(/.test(controller) || /; Secure/.test(controller));
check('controller-httponly', /httponly/i.test(controller));
check('controller-samesite-lax', /SameSite=Lax/.test(controller) || /"Lax"/.test(controller));
// §4 triple-check: fetch metadata + trusted origin + session-bound CSRF.
check('controller-fetch-metadata', controller.includes('Sec-Fetch-Site'));
check('controller-origin-check', /Origin|origin/.test(controller));
check('controller-session-csrf', controller.includes('verifyCsrf'));

// Mutating handler methods must each carry the CSRF gate (verifyCsrf or the
// csrf(...) helper that wraps it). Count mappings vs csrf call sites.
const mutatingMappings = (controller.match(/@(PostMapping|PutMapping|PatchMapping|DeleteMapping)/g) ?? []).length;
const csrfCalls = (controller.match(/verifyCsrf\(|checkCsrf\(/g) ?? []).length;
check('controller-csrf-coverage', mutatingMappings === 0 || csrfCalls >= mutatingMappings,
  `${mutatingMappings} mutating mappings vs ${csrfCalls} csrf checks`);

const proxy = sources.get('BffApiProxyController.java') ?? '';
check('proxy-nostore', /no-store/.test(proxy));
check('proxy-allowlist', proxy.includes('getApiAllowlist'));
check('proxy-strips-cookie', /"cookie"/i.test(proxy));
check('proxy-strips-authorization', /"authorization"/i.test(proxy));
check('proxy-strips-bff-secret', proxy.includes('x-campuscore-bff-secret'));
check('proxy-injects-bearer', proxy.includes('Bearer '));
check('proxy-no-setcookie-passthrough', /Set-Cookie/i.test(proxy));
// upstream Set-Cookie must never reach the browser — the strip list must
// cover response headers too.
check('proxy-response-strips-setcookie', /strip|exclude|skip/i.test(proxy) && /set-cookie/i.test(proxy));

const service = sources.get('BffSessionService.java') ?? '';
check('service-single-flight', service.includes('ConcurrentHashMap') || service.includes('computeIfAbsent'));
check('service-no-db-lock-over-http', !/for update[\s\S]{0,400}tokens\.(refresh|exchangeCode)/i.test(service));
check('service-revokes-on-refresh-failure', service.includes('revokeSession'));

const tokenClient = sources.get('BffTokenClient.java') ?? '';
check('loopback-sends-surface-pair', /x-campuscore-surface/i.test(tokenClient)
  && /x-campuscore-bff-secret/i.test(tokenClient));
check('loopback-basic-auth', tokenClient.includes('Basic ') || tokenClient.includes('HttpBasicCredentials'));

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`static-policy FAIL: ${failed.length}/${results.length} sentinel(s) tripped`);
  process.exit(1);
}
console.log(`static-policy PASS: ${results.length} sentinels`);

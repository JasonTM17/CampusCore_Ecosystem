import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const caddyfilePath = path.join(repoRoot, 'ops', 'edge', 'Caddyfile.local');
const composePath = path.join(repoRoot, 'docker-compose.yml');

test('local edge Caddyfile exists and listens on :80 inside the container', () => {
  const text = readFileSync(caddyfilePath, 'utf8');
  assert.match(text, /^:80 \{/m, 'site block must bind :80');
  assert.match(text, /auto_https off/, 'local edge must not request certificates');
});

test('registrar and bursar matchers precede the /api/v1 catch-all', () => {
  const text = readFileSync(caddyfilePath, 'utf8');
  const registrarIdx = text.indexOf('@registrar');
  const bursarIdx = text.indexOf('@bursar');
  const catchAllIdx = text.indexOf('@api path /api/v1/*');
  assert.ok(registrarIdx > -1, 'missing @registrar matcher');
  assert.ok(bursarIdx > -1, 'missing @bursar matcher');
  assert.ok(catchAllIdx > -1, 'missing /api/v1 catch-all');
  assert.ok(registrarIdx < catchAllIdx, '@registrar must be evaluated before the catch-all');
  assert.ok(bursarIdx < catchAllIdx, '@bursar must be evaluated before the catch-all');
});

test('service prefixes point at their dedicated upstreams', () => {
  const text = readFileSync(caddyfilePath, 'utf8');
  assert.match(text, /@registrar \{[^}]*path \/api\/v1\/me\/registration\*/s, 'registrar must match /me/registration*');
  assert.match(text, /me\/enrollments\*/, 'registrar must match /me/enrollments*');
  assert.match(text, /@bursar \{[^}]*me\/bursar\*/s, 'bursar must match /me/bursar*');
  assert.match(text, /reverse_proxy @registrar enrollment-api:4013/, 'registrar upstream must be enrollment-api:4013');
  assert.match(text, /reverse_proxy @bursar bursar-api:4012/, 'bursar upstream must be bursar-api:4012');
});

test('assistant streaming is never buffered or compressed', () => {
  const text = readFileSync(caddyfilePath, 'utf8');
  assert.match(text, /@assistant_stream[\s\S]*flush_interval -1/, 'stream route must flush immediately');
});

test('edge service is pinned by digest and bound to localhost only', () => {
  const text = readFileSync(composePath, 'utf8');
  const edgeBlock = text.slice(text.indexOf('\n  edge:'), text.indexOf('\nvolumes:'));
  assert.match(edgeBlock, /image: caddy:2\.10\.2-alpine@sha256:[0-9a-f]{64}/, 'edge image must carry a sha256 digest');
  assert.match(edgeBlock, /127\.0\.0\.1:\$\{EDGE_HOST_PORT:-8080\}:80/, 'edge must bind loopback only');
});

test('sis-core alias is declared on the restful-api service', () => {
  const text = readFileSync(composePath, 'utf8');
  const apiBlock = text.slice(text.indexOf('\n  restful-api:'), text.indexOf('\n  web:'));
  assert.match(apiBlock, /aliases:\s*\n\s*- sis-core/, 'restful-api must answer to the sis-core network alias');
});

'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

function versionedGuard(expected, actual) { if (expected !== actual) throw Error('stale version'); }
function deny(fn) { assert.throws(fn); }

function approval() {
  const s = { requester: 'owner', level: 0, version: 0, keys: new Map() };
  const roles = ['lead', 'director'];
  function apply(actor, level, key, expected = s.version) {
    if (actor === s.requester || actor !== roles[level - 1]) throw Error('unauthorized approver');
    if (s.keys.has(key)) {
      const prior = s.keys.get(key);
      if (prior.actor !== actor || prior.level !== level) throw Error('key payload mismatch');
      return prior.level;
    }
    versionedGuard(expected, s.version);
    if (level !== s.level + 1) throw Error('unordered approval');
    s.level = level; s.version++; s.keys.set(key, { actor, level }); return level;
  }
  return { s, apply };
}

function exception() {
  const s = { active: false, reason: '', expires: 0, version: 0 };
  function approve(actor, scope, reason, expires, expected = s.version) {
    versionedGuard(expected, s.version);
    if (actor !== 'exception-owner' || scope !== 'team-a' || !reason || expires <= 10) throw Error('no exception authority');
    Object.assign(s, { active: true, reason, expires, version: s.version + 1 });
  }
  function use(now) { if (!s.active || now >= s.expires) throw Error('inactive exception'); return true; }
  function revoke() { s.active = false; s.version++; }
  return { s, approve, use, revoke };
}

function refund() {
  const s = { captured: 100, refunded: 0, version: 0, keys: new Map() };
  function apply(key, amount, tenant = 'team-a', expected = s.version) {
    if (tenant !== 'team-a') throw Error('tenant denied');
    if (s.keys.has(key)) { if (s.keys.get(key) !== amount) throw Error('key payload mismatch'); return amount; }
    versionedGuard(expected, s.version);
    if (!Number.isInteger(amount) || amount <= 0 || s.refunded + amount > s.captured) throw Error('refund limit');
    s.refunded += amount; s.version++; s.keys.set(key, amount); return amount;
  }
  return { s, apply };
}

function inventory() {
  const s = { stock: 1, version: 0, holds: new Map() };
  function reserve(key, tenant = 'team-a', expected = s.version) {
    if (tenant !== 'team-a') throw Error('tenant denied');
    if (s.holds.has(key)) return key;
    versionedGuard(expected, s.version);
    if (s.stock < 1) throw Error('out of stock');
    s.stock--; s.holds.set(key, true); s.version++; return key;
  }
  function expire(key) { if (s.holds.get(key) === true) { s.holds.set(key, false); s.stock++; s.version++; } }
  return { s, reserve, expire };
}

function grant() {
  const s = { version: 1, active: true };
  function access(tenant, tokenVersion) {
    if (tenant !== 'team-a' || !s.active || tokenVersion !== s.version) throw Error('revoked or wrong tenant');
    return true;
  }
  function revoke() { s.active = false; s.version++; }
  return { s, access, revoke };
}

function quota() {
  const s = { limit: 10, used: 0, version: 0, keys: new Map() };
  function consume(key, units, tenant = 'team-a', expected = s.version) {
    if (tenant !== 'team-a') throw Error('tenant denied');
    if (s.keys.has(key)) { if (s.keys.get(key) !== units) throw Error('key payload mismatch'); return units; }
    versionedGuard(expected, s.version);
    if (!Number.isInteger(units) || units < 1 || s.used + units > s.limit) throw Error('quota exceeded');
    s.used += units; s.version++; s.keys.set(key, units); return units;
  }
  return { s, consume };
}

function webhook() {
  const s = { version: 0, effects: 0, seen: new Map(), pending: new Map() };
  function receive(id, version, authenticated = true) {
    if (!authenticated) throw Error('unauthenticated event');
    if (!Number.isSafeInteger(version) || version < 1) throw Error('invalid aggregate version');
    if (s.seen.has(id)) {
      if (s.seen.get(id) !== version) throw Error('event ID conflict');
      return 'duplicate';
    }
    if (version <= s.version) throw Error('stale event');
    if (s.pending.has(version)) throw Error('aggregate version conflict');
    s.seen.set(id, version); s.pending.set(version, id);
    while (s.pending.has(s.version + 1)) { s.pending.delete(s.version + 1); s.version++; s.effects++; }
    return 'accepted';
  }
  return { s, receive };
}

function importer() {
  const s = { checkpoint: 0, rows: new Set(), version: 0 };
  function row(id, tenant = 'team-a', expected = s.version) {
    if (tenant !== 'team-a') throw Error('tenant denied');
    if (s.rows.has(id)) return 'duplicate';
    versionedGuard(expected, s.version);
    if (id !== s.checkpoint + 1) throw Error('checkpoint gap');
    s.rows.add(id); s.checkpoint = id; s.version++; return 'imported';
  }
  return { s, row };
}

function mobile() {
  const s = { revision: 1, body: 'remote-v1', applied: new Map() };
  function sync(key, body, baseRevision, tenant = 'team-a') {
    if (tenant !== 'team-a') throw Error('tenant denied');
    if (s.applied.has(key)) { if (s.applied.get(key) !== body) throw Error('key conflict'); return s.revision; }
    if (baseRevision !== s.revision) throw Error('merge required');
    s.body = body; s.revision++; s.applied.set(key, body); return s.revision;
  }
  return { s, sync };
}

function desktop() {
  const s = { version: 0, temporary: new Map(), published: new Map() };
  function safe(target) { if (!/^workspace\/[a-z0-9-]+\.txt$/.test(target)) throw Error('path denied'); }
  function stage(target, body) { safe(target); const digest = createHash('sha256').update(body).digest('hex'); s.temporary.set(target, { body, digest }); return digest; }
  function publish(target, expectedVersion = s.version, expectedDigest) {
    safe(target); versionedGuard(expectedVersion, s.version);
    const staged = s.temporary.get(target); if (!staged) throw Error('no staged file');
    if (staged.digest !== expectedDigest) throw Error('staged digest mismatch');
    assert.equal(createHash('sha256').update(staged.body).digest('hex'), staged.digest);
    s.published.set(target, staged); s.temporary.delete(target); s.version++; return staged.digest;
  }
  return { s, stage, publish };
}

function rag() {
  const s = { indexOnline: true, grants: new Set(['team-a']), docs: [{ id: 'doc-a', tenant: 'team-a', text: 'A' }, { id: 'doc-b', tenant: 'team-b', text: 'B' }] };
  function retrieve(tenant) { if (!s.indexOnline) throw Error('index unavailable'); return s.docs.filter(d => d.tenant === tenant && s.grants.has(tenant)); }
  function answer(tenant, sources) { if (!s.grants.has(tenant) || !Array.isArray(sources) || !sources.length || sources.some(d => d.tenant !== tenant || !s.docs.includes(d))) throw Error('source denied'); return { text: sources.map(d => d.text).join(' '), citations: sources.map(d => d.id) }; }
  return { s, retrieve, answer };
}

function toolEffect() {
  const s = { grant: true, epoch: 1, effects: new Map() };
  function act(key, payload, tenant = 'team-a', epoch = s.epoch) {
    if (tenant !== 'team-a' || !s.grant || epoch !== s.epoch) throw Error('tool authority denied');
    if (s.effects.has(key)) { if (s.effects.get(key) !== payload) throw Error('key payload mismatch'); return 'replay'; }
    s.effects.set(key, payload); return 'applied';
  }
  function revoke() { s.grant = false; s.epoch++; }
  return { s, act, revoke };
}

const cases = {
  'multi-level-approval': {
    success: () => { const x = approval(); x.apply('lead', 1, 'one'); x.apply('director', 2, 'two'); assert.equal(x.s.level, 2); },
    denied: () => { const x = approval(); deny(() => x.apply('owner', 1, 'one')); assert.equal(x.s.level, 0); x.apply('lead', 1, 'one'); deny(() => x.apply('intruder', 1, 'one')); deny(() => x.apply('director', 2, 'one')); assert.equal(x.s.level, 1); },
    recovery: () => { const x = approval(); x.apply('lead', 1, 'one'); assert.equal(x.apply('lead', 1, 'one'), 1); assert.equal(x.s.version, 1); },
    contention: () => { const x = approval(); const v = x.s.version; x.apply('lead', 1, 'one', v); deny(() => x.apply('lead', 1, 'two', v)); assert.equal(x.s.level, 1); }
  },
  'authorized-exception': {
    success: () => { const x = exception(); x.approve('exception-owner', 'team-a', 'incident', 20); assert.equal(x.use(11), true); },
    denied: () => { const x = exception(); deny(() => x.approve('member', 'team-a', 'x', 20)); assert.equal(x.s.active, false); },
    recovery: () => { const x = exception(); x.approve('exception-owner', 'team-a', 'incident', 20); deny(() => x.use(21)); x.revoke(); assert.equal(x.s.active, false); },
    contention: () => { const x = exception(); const v = x.s.version; x.revoke(); deny(() => x.approve('exception-owner', 'team-a', 'x', 20, v)); assert.equal(x.s.active, false); }
  },
  'partial-refund': {
    success: () => { const x = refund(); x.apply('r1', 40); x.apply('r2', 60); assert.equal(x.s.refunded, 100); },
    denied: () => { const x = refund(); deny(() => x.apply('r1', 10, 'team-b')); assert.equal(x.s.refunded, 0); },
    recovery: () => { const x = refund(); x.apply('r1', 40); assert.equal(x.apply('r1', 40), 40); deny(() => x.apply('r1', 50)); assert.equal(x.s.refunded, 40); },
    contention: () => { const x = refund(); const v = x.s.version; x.apply('r1', 70, 'team-a', v); deny(() => x.apply('r2', 70, 'team-a', v)); assert.ok(x.s.refunded <= x.s.captured); }
  },
  'inventory-reservation': {
    success: () => { const x = inventory(); x.reserve('h1'); assert.equal(x.s.stock, 0); },
    denied: () => { const x = inventory(); deny(() => x.reserve('h1', 'team-b')); assert.equal(x.s.stock, 1); },
    recovery: () => { const x = inventory(); x.reserve('h1'); x.reserve('h1'); x.expire('h1'); x.expire('h1'); assert.equal(x.s.stock, 1); },
    contention: () => { const x = inventory(); const v = x.s.version; x.reserve('h1', 'team-a', v); deny(() => x.reserve('h2', 'team-a', v)); assert.equal(x.s.stock, 0); }
  },
  'tenant-revocation': {
    success: () => { const x = grant(); assert.equal(x.access('team-a', 1), true); },
    denied: () => { const x = grant(); deny(() => x.access('team-b', 1)); },
    recovery: () => { const x = grant(); x.revoke(); deny(() => x.access('team-a', 1)); assert.equal(x.s.active, false); },
    contention: () => { const x = grant(); const token = x.s.version; x.revoke(); deny(() => x.access('team-a', token)); }
  },
  'subscription-quota': {
    success: () => { const x = quota(); x.consume('q1', 4); x.consume('q2', 6); assert.equal(x.s.used, 10); },
    denied: () => { const x = quota(); deny(() => x.consume('q1', 1, 'team-b')); assert.equal(x.s.used, 0); },
    recovery: () => { const x = quota(); x.consume('q1', 4); x.consume('q1', 4); deny(() => x.consume('q1', 5)); assert.equal(x.s.used, 4); },
    contention: () => { const x = quota(); const v = x.s.version; x.consume('q1', 7, 'team-a', v); deny(() => x.consume('q2', 7, 'team-a', v)); assert.ok(x.s.used <= x.s.limit); }
  },
  'webhook-ordering': {
    success: () => { const x = webhook(); x.receive('e1', 1); x.receive('e2', 2); assert.equal(x.s.effects, 2); },
    denied: () => { const x = webhook(); deny(() => x.receive('e1', 1, false)); deny(() => x.receive('bad', '1')); assert.equal(x.s.effects, 0); },
    recovery: () => { const x = webhook(); x.receive('e1', 1); assert.equal(x.receive('e1', 1), 'duplicate'); deny(() => x.receive('e1', 2)); assert.equal(x.s.effects, 1); },
    contention: () => { const x = webhook(); x.receive('e2', 2); assert.equal(x.s.effects, 0); deny(() => x.receive('e2-conflict', 2)); assert.equal(x.s.seen.has('e2-conflict'), false); x.receive('e1', 1); x.receive('e2', 2); assert.equal(x.s.effects, 2); }
  },
  'import-recovery': {
    success: () => { const x = importer(); x.row(1); x.row(2); assert.equal(x.s.checkpoint, 2); },
    denied: () => { const x = importer(); deny(() => x.row(1, 'team-b')); assert.equal(x.s.rows.size, 0); },
    recovery: () => { const x = importer(); x.row(1); assert.equal(x.row(1), 'duplicate'); x.row(2); assert.equal(x.s.rows.size, 2); },
    contention: () => { const x = importer(); const v = x.s.version; x.row(1, 'team-a', v); deny(() => x.row(2, 'team-a', v)); assert.equal(x.s.checkpoint, 1); }
  },
  'offline-sync': {
    success: () => { const x = mobile(); x.sync('edit1', 'local-v2', 1); assert.equal(x.s.body, 'local-v2'); },
    denied: () => { const x = mobile(); deny(() => x.sync('edit1', 'x', 1, 'team-b')); assert.equal(x.s.revision, 1); },
    recovery: () => { const x = mobile(); x.sync('edit1', 'local-v2', 1); x.sync('edit1', 'local-v2', 1); assert.equal(x.s.revision, 2); },
    contention: () => { const x = mobile(); x.sync('remote', 'remote-v2', 1); deny(() => x.sync('offline', 'local-v2', 1)); assert.equal(x.s.body, 'remote-v2'); }
  },
  'desktop-file-resume': {
    success: () => { const x = desktop(); const digest = x.stage('workspace/report.txt', 'final'); assert.equal(x.publish('workspace/report.txt', x.s.version, digest), digest); },
    denied: () => { const x = desktop(); deny(() => x.stage('../private.txt', 'x')); assert.equal(x.s.published.size, 0); },
    recovery: () => { const x = desktop(); const firstDigest = x.stage('workspace/report.txt', 'first'); const finalDigest = x.stage('workspace/report.txt', 'final'); deny(() => x.publish('workspace/report.txt', x.s.version, firstDigest)); assert.equal(x.s.published.size, 0); assert.equal(x.publish('workspace/report.txt', x.s.version, finalDigest), finalDigest); assert.equal(x.s.published.get('workspace/report.txt').body, 'final'); },
    contention: () => { const x = desktop(); const v = x.s.version; const oneDigest = x.stage('workspace/one.txt', 'one'); x.publish('workspace/one.txt', v, oneDigest); const twoDigest = x.stage('workspace/two.txt', 'two'); deny(() => x.publish('workspace/two.txt', v, twoDigest)); assert.equal(x.s.published.size, 1); }
  },
  'rag-source-access': {
    success: () => { const x = rag(); const answer = x.answer('team-a', x.retrieve('team-a')); assert.deepEqual(answer.citations, ['doc-a']); },
    denied: () => { const x = rag(); deny(() => x.answer('team-a', x.s.docs.filter(d => d.tenant === 'team-b'))); deny(() => x.answer('team-a', [{ id: 'forged', tenant: 'team-a', text: 'fabricated' }])); deny(() => x.answer('team-a', [])); },
    recovery: () => { const x = rag(); x.s.indexOnline = false; deny(() => x.retrieve('team-a')); x.s.indexOnline = true; assert.equal(x.retrieve('team-a').length, 1); },
    contention: () => { const x = rag(); const sources = x.retrieve('team-a'); x.s.grants.delete('team-a'); deny(() => x.answer('team-a', sources)); }
  },
  'agent-tool-effect': {
    success: () => { const x = toolEffect(); assert.equal(x.act('k1', 'create'), 'applied'); assert.equal(x.s.effects.size, 1); },
    denied: () => { const x = toolEffect(); deny(() => x.act('k1', 'create', 'team-b')); assert.equal(x.s.effects.size, 0); },
    recovery: () => { const x = toolEffect(); x.act('k1', 'create'); assert.equal(x.act('k1', 'create'), 'replay'); assert.equal(x.s.effects.size, 1); },
    contention: () => { const x = toolEffect(); x.act('k1', 'create'); deny(() => x.act('k1', 'delete')); x.revoke(); deny(() => x.act('k2', 'create', 'team-a', 1)); assert.equal(x.s.effects.size, 1); }
  }
};

module.exports = { cases };

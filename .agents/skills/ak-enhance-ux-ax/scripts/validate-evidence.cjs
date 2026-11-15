#!/usr/bin/env node
'use strict';
// Integrity validation only. The caller authenticates controller inputs and
// independently observes browser/vision execution; these JSON records cannot.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const common = require('../../ak-common/scripts/verification-receipt.cjs');
const { safeRelative } = require('../../ak-common/scripts/workflow-contract.cjs');
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]*$/i;
const STATUSES = ['PASS', 'FAIL', 'NOT_RUN', 'BLOCKED_CAPABILITY'];
const FRAME_KEYS = ['route', 'role', 'state', 'width', 'height', 'scale', 'theme', 'fixture', 'browser', 'platform', 'fonts'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const covered = (p, scope) => scope.some(s => p === s || p.startsWith(s + '/'));
const strings = a => Array.isArray(a) && a.every(x => typeof x === 'string' && x.trim());
function sourceSnapshot(root, scope) {
  if (!Array.isArray(scope) || !scope.length || scope.some(p => !safeRelative(p))) throw Error('invalid portable scope');
  return common.snapshot(path.resolve(root), scope);
}
function validSnapshot(s) {
  return s && HASH.test(s.sha256) && Array.isArray(s.files) &&
    s.files.every(f => f && safeRelative(f.path) && HASH.test(f.sha256)) &&
    new Set(s.files.map(f => f.path)).size === s.files.length;
}
function parseMode(argv) {
  let mode = 'audit'; let maxRounds = 0; let target = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--auto' && mode === 'audit') { mode = 'auto'; maxRounds = 1; }
    else if (a === '--loop' && mode === 'audit' && /^[1-3]$/.test(argv[i + 1] || '')) { mode = 'loop'; maxRounds = Number(argv[++i]); }
    else if (!a.startsWith('-') && target === null && a.trim()) target = a;
    else throw Error('invalid, duplicate or conflicting mode arguments');
  }
  return { mode, maxRounds, target };
}
function parseOptions(argv, required) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, '');
    if (!argv[i]?.startsWith('--') || !required.includes(k) || opts[k] || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('invalid CLI arguments');
    opts[k] = argv[i + 1];
  }
  if (required.some(k => !opts[k])) throw Error('missing CLI arguments');
  return opts;
}
function validateContract(c) {
  const errors = []; const fail = s => errors.push(s);
  if (!c || c.version !== 1 || !ID.test(c.runId || '') || !ID.test(c.owner || '')) return ['invalid controller contract'];
  if (!['audit', 'auto', 'loop'].includes(c.mode) || !Number.isInteger(c.maxRounds) ||
      (c.mode === 'audit' ? c.maxRounds !== 0 : c.mode === 'auto' ? c.maxRounds !== 1 : c.maxRounds < 1 || c.maxRounds > 3)) fail('invalid mode/round authority');
  for (const k of ['sourceScope', 'allowedWrites']) if (!Array.isArray(c[k]) || c[k].some(p => !safeRelative(p))) fail(`invalid ${k}`);
  if (!c.sourceScope?.length || !validSnapshot(c.initialSnapshot)) fail('source scope and trusted initial snapshot required');
  if (Array.isArray(c.allowedWrites) && Array.isArray(c.sourceScope) && c.allowedWrites.some(p => !covered(p, c.sourceScope))) fail('writes outside inspected source scope');
  if (c.mode === 'audit' && c.allowedWrites?.length) fail('audit cannot authorize source writes');
  if (typeof c.artifactRoot !== 'string' || !path.isAbsolute(c.artifactRoot)) fail('caller-resolved absolute artifact root required');
  if (!Number.isInteger(c.maxAgeMs) || c.maxAgeMs < 1 || c.maxAgeMs > 86400000) fail('bounded maxAgeMs required');
  if (!Array.isArray(c.gates) || !c.gates.length || new Set(c.gates.map(g => g?.id)).size !== c.gates.length) fail('unique controller gates required');
  for (const g of Array.isArray(c.gates) ? c.gates : []) {
    if (!g || !ID.test(g.id || '') || !['browser', 'source', 'command', 'ax'].includes(g.kind) ||
        !Array.isArray(g.scope) || !g.scope.length || g.scope.some(p => !safeRelative(p) || !covered(p, c.sourceScope || [])) ||
        ['required', 'critical', 'applicable'].some(k => typeof g[k] !== 'boolean') || (!g.applicable && !g.reason?.trim())) { fail('invalid controller gate'); continue; }
    if (g.kind === 'command') {
      try { common.validateSpec(g.spec); if (!equal(g.spec.scope, g.scope)) fail('command gate scope mismatch'); }
      catch { fail('invalid command gate spec'); }
    }
  }
  if (!Array.isArray(c.frames) || new Set(c.frames.map(f => f?.id)).size !== c.frames.length) fail('unique frame definitions required');
  for (const f of Array.isArray(c.frames) ? c.frames : []) {
    if (!f || !ID.test(f.id || '') || !f.conditions || FRAME_KEYS.some(k => f.conditions[k] === undefined) ||
        !Number.isInteger(f.conditions.width) || f.conditions.width < 1 || !Number.isInteger(f.conditions.height) || f.conditions.height < 1 ||
        typeof f.conditions.scale !== 'number' || f.conditions.scale <= 0 ||
        FRAME_KEYS.filter(k => !['width', 'height', 'scale'].includes(k)).some(k => typeof f.conditions[k] !== 'string' || !f.conditions[k].trim())) fail('invalid frame conditions');
    if (f?.captureWidth !== undefined && (f.captureKind !== 'full-page' || !Number.isInteger(f.captureWidth) || f.captureWidth < 1)) fail('invalid controller capture width');
  }
  if (typeof c.requireVision !== 'boolean' || !strings(c.visionObservers) || c.visionObservers.includes(c.owner) ||
      (c.requireVision && (!c.frames?.length || !c.visionObservers.length))) fail('invalid independent vision authority');
  if (!Array.isArray(c.publicExports) || c.publicExports.some(p => !safeRelative(p))) fail('controller public export allowlist required');
  return errors;
}
function artifact(root, relative) {
  if (!safeRelative(relative)) throw Error('invalid artifact path');
  const s = sourceSnapshot(root, [relative]);
  if (s.files.length !== 1 || s.files[0].path !== relative) throw Error('artifact must be one regular file');
  return { path: path.join(root, relative), sha256: s.files[0].sha256 };
}
function fresh(time, start, now, age) {
  const t = Date.parse(time); const s = Date.parse(start);
  return Number.isFinite(t) && Number.isFinite(s) && t >= s && t <= now + 60000 && now - t <= age;
}
// Bounded readable PNG profile: 8-bit, noninterlaced gray/RGB with optional
// alpha. Validate chunk CRC and decompress every scanline, not just IHDR.
function readablePng(bytes) {
  try {
    if (bytes.length < 57 || bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
    const crc = data => { let value = 0xffffffff; for (const octet of data) { value ^= octet; for (let i=0;i<8;i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
    let offset=8, header=null, ended=false, afterData=false; const data=[];
    while (offset + 12 <= bytes.length) {
      const length=bytes.readUInt32BE(offset), type=bytes.toString('ascii',offset+4,offset+8), end=offset+12+length;
      if (end>bytes.length || !/^[A-Za-z]{4}$/.test(type) || crc(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4)) return false;
      const body=bytes.subarray(offset+8,end-4);
      if (!header && type!=='IHDR') return false;
      if (type==='IHDR') { if(header || length!==13)return false; header=body; }
      else if(type==='IDAT') { if(afterData)return false; data.push(body); }
      else if(type==='IEND') { if(length || !data.length || end!==bytes.length)return false; ended=true; }
      else { if(type[0]===type[0].toUpperCase() && type!=='PLTE')return false; if(data.length)afterData=true; }
      offset=end;
    }
    if(!ended || offset!==bytes.length || !header)return false;
    const width=header.readUInt32BE(0), height=header.readUInt32BE(4), channels=({0:1,2:3,4:2,6:4})[header[9]];
    if(!width || !height || header[8]!==8 || !channels || header[10] || header[11] || header[12])return false;
    const stride=width*channels+1, expected=stride*height;
    if(expected>64*1024*1024)return false;
    const raw=zlib.inflateSync(Buffer.concat(data),{maxOutputLength:expected});
    if(raw.length!==expected)return false;
    for(let row=0;row<height;row++)if(raw[row*stride]>4)return false;
    return true;
  } catch { return false; }
}
function changes(before, after) {
  const b = new Map(before.files.map(f => [f.path, f.sha256]));
  const a = new Map(after.files.map(f => [f.path, f.sha256]));
  return [...new Set([...b.keys(), ...a.keys()])].sort().filter(p => b.get(p) !== a.get(p)).map(p => ({ path: p, beforeSha256: b.get(p) || null, afterSha256: a.get(p) || null }));
}
function validate(root, c, b, { now = Date.now(), expectedBefore = c?.initialSnapshot, carried = new Map() } = {}) {
  const errors = validateContract(c); const missing = []; const fail = s => errors.push(s);
  const result = () => ({ integrity: errors.length ? 'FAIL' : 'PASS', completion: errors.length || missing.length ? 'FAIL' : 'PASS', errors, missing,
    limitation: 'Declared integrity only; caller must observe execution and authenticate authority/vision.', coverage: { applicable: c?.gates?.filter(g => g.applicable).length || 0, pass: b?.checks?.filter(x => x.status === 'PASS').length || 0 } });
  if (errors.length) return result();
  if (!b || b.version !== 1 || b.runId !== c.runId || b.owner !== c.owner || !['audit', 'improved', 'partial'].includes(b.claim)) { fail('invalid bundle identity/claim'); return result(); }
  if (b.contract || b.allowedWrites || b.requiredGates || b.requireVision !== undefined) fail('bundle cannot redefine controller authority');
  if (!Number.isInteger(b.round) || (c.mode === 'audit' ? b.round !== 0 || b.claim !== 'audit' : b.round < 1 || b.round > c.maxRounds || b.claim === 'audit')) fail('round or claim outside authority');
  if (!fresh(b.startedAt, b.startedAt, now, c.maxAgeMs)) fail('stale bundle');
  if (!validSnapshot(b.before) || !validSnapshot(b.current) || !equal(b.before, expectedBefore)) { fail('untrusted or mismatched before snapshot'); return result(); }
  let actual;
  try {
    actual = sourceSnapshot(root, c.sourceScope);
    const realSource = fs.realpathSync(root); const realArtifacts = fs.realpathSync(c.artifactRoot);
    const rel = path.relative(realSource, realArtifacts);
    if (rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) fail('artifact root overlaps source root');
  } catch { fail('source/artifact scope unavailable or escaped'); return result(); }
  if (!equal(actual, b.current)) fail('stale current source snapshot');
  for (const k of ['writes', 'checks', 'frames', 'findings', 'exports', 'vision']) if (!Array.isArray(b[k])) fail(`${k} must be an array`);
  if (errors.length) return result();
  const find = new Map();
  for (const f of b.findings) {
    if (!f || !ID.test(f.id || '') || find.has(f.id) || !['Must', 'Should', 'Could'].includes(f.priority) ||
        !['confirmed', 'hypothesis'].includes(f.confidence) || !['OPEN', 'FIXED_UNVERIFIED', 'VERIFIED', 'DEFERRED', 'BLOCKED'].includes(f.status) ||
        typeof f.applicable !== 'boolean' || (!f.applicable && !f.reason?.trim()) || !strings(f.evidence) || !strings(f.checkIds)) { fail('invalid finding'); continue; }
    find.set(f.id, f);
    if (b.claim === 'improved' && f.applicable && f.priority !== 'Could' && f.status !== 'VERIFIED') missing.push(`${f.id}: unresolved improvement`);
  }
  const diff = changes(b.before, actual);
  if (c.mode === 'audit' && diff.length) fail('audit changed source');
  if (b.writes.length !== diff.length || new Set(b.writes.map(w => w?.path)).size !== b.writes.length) fail('writes must exactly cover source delta');
  for (const w of b.writes) {
    const d = diff.find(x => x.path === w?.path); const f = find.get(w?.findingId);
    if (!d || !safeRelative(w.path) || !covered(w.path, c.allowedWrites) || w.beforeSha256 !== d.beforeSha256 || w.afterSha256 !== d.afterSha256) fail('unauthorized or mismatched write');
    if (!f || f.confidence !== 'confirmed' || !['Must', 'Should'].includes(f.priority) || !f.applicable || !f.evidence.length) fail('write requires confirmed applicable Must/Should evidence');
  }
  const checks = new Map();
  for (const x of b.checks) {
    const g = c.gates.find(gate => gate.id === x?.id);
    if (!g || checks.has(x.id) || !STATUSES.includes(x.status) || x.kind !== undefined && x.kind !== g.kind || x.applicable !== undefined && x.applicable !== g.applicable) { fail('unknown/duplicate/redefined check'); continue; }
    checks.set(x.id, x);
    if (!g.applicable) { fail('nonapplicable gate submitted as evidence'); continue; }
    if (x.status !== 'PASS') { if (!x.reason?.trim()) fail('unpassed check needs reason'); continue; }
    const scope = sourceSnapshot(root, g.scope);
    if (x.carriedFrom) {
      const prior = carried.get(x.id);
      if (!prior || x.carriedFrom !== prior.from || prior.check.status !== 'PASS' || !equal(scope, prior.check.snapshot) || !equal(x.snapshot, scope) || !equal({ ...x, carriedFrom: undefined }, { ...prior.check, carriedFrom: undefined })) fail('invalid or affected PASS carry');
      continue;
    }
    if (!equal(x.snapshot, scope) || !fresh(x.checkedAt, b.startedAt, now, c.maxAgeMs)) fail('stale check scope/time');
    try {
      const a = artifact(c.artifactRoot, x.evidencePath);
      if (a.sha256 !== x.sha256) fail('check artifact changed');
      const record = JSON.parse(fs.readFileSync(a.path, 'utf8'));
      if (record.id !== x.id || record.status !== x.status || !equal(record.snapshot, x.snapshot) || record.checkedAt !== x.checkedAt) fail('check artifact contradicts bundle');
    } catch { fail('unreadable or escaped check artifact'); }
    if (g.kind === 'command' && common.check(root, g.spec, x.receipt, now).status !== 'PASS') fail('command receipt invalid');
  }
  for (const g of c.gates) if (g.applicable && (g.required || g.critical) && checks.get(g.id)?.status !== 'PASS') missing.push(`${g.id}: required check did not pass`);
  for (const f of find.values()) if (f.status === 'VERIFIED' && (!f.evidence.length || !f.checkIds.length || f.checkIds.some(id => checks.get(id)?.status !== 'PASS'))) fail('verified finding lacks passing evidence');
  const frames = new Map();
  for (const f of b.frames) {
    const expected = c.frames.find(x => x.id === f?.id);
    if (!expected || frames.has(f.id) || !equal(f.conditions, expected.conditions) || f.snapshot !== actual.sha256 || !fresh(f.capturedAt, b.startedAt, now, c.maxAgeMs)) { fail('unknown/stale/mismatched frame'); continue; }
    try {
      const a = artifact(c.artifactRoot, f.artifact); const bytes = fs.readFileSync(a.path);
      const png = readablePng(bytes);
      const width = expected.captureWidth ?? Math.round(f.conditions.width * f.conditions.scale);
      if (f.captureWidth !== undefined || Boolean(f.fullPage) !== (expected.captureKind === 'full-page') || a.sha256 !== f.sha256 || !png || bytes.readUInt32BE(16) !== width ||
          (f.canvas && (!png || f.canvas.width !== bytes.readUInt32BE(16) || f.canvas.height !== bytes.readUInt32BE(20))) ||
          (!f.fullPage && bytes.readUInt32BE(20) !== Math.round(f.conditions.height * f.conditions.scale)) ||
          (f.fullPage && bytes.readUInt32BE(20) < Math.round(f.conditions.height * f.conditions.scale))) fail('changed or incompatible PNG capture');
      frames.set(f.id, f);
    } catch { fail('missing or escaped capture'); }
  }
  for (const f of c.frames) if (!frames.has(f.id)) missing.push(`${f.id}: required capture missing`);
  const reviewed = new Set();
  for (const v of b.vision) {
    if (!v || !c.visionObservers.includes(v.observer) || v.observer === c.owner || !STATUSES.includes(v.status) || !v.notes?.trim() || !Array.isArray(v.frames) || !fresh(v.reviewedAt, b.startedAt, now, c.maxAgeMs)) { fail('invalid independent vision declaration'); continue; }
    for (const ref of v.frames) {
      const f = frames.get(ref?.id);
      if (!f || ref.sha256 !== f.sha256) fail('vision references wrong capture');
      else if (v.status === 'PASS') reviewed.add(f.id);
    }
  }
  if (c.requireVision) for (const f of c.frames) if (!reviewed.has(f.id)) missing.push(`${f.id}: required independent vision missing`);
  for (const e of b.exports) {
    if (!e || e.classification !== 'public' || !c.publicExports.includes(e.path)) { fail('private/unclassified or unauthorized export forbidden'); continue; }
    try { artifact(c.artifactRoot, e.path); } catch { fail('export path unavailable or escaped'); }
  }
  if (b.claim === 'partial') missing.push('partial claim cannot complete improvement');
  return result();
}
function rollbackGuard(root, patches) {
  try {
    if (!Array.isArray(patches) || !patches.length || new Set(patches.map(p => p.path)).size !== patches.length) throw Error('unique owned patches required');
    for (const p of patches) {
      if (!safeRelative(p.path) || !HASH.test(p.beforeSha256) || !HASH.test(p.afterSha256)) throw Error('invalid owned patch');
      if (sourceSnapshot(root, [p.path]).files[0]?.sha256 !== p.afterSha256) throw Error('concurrent overlap or stale postimage; reversal refused');
    }
    return { status: 'PASS', limitation: 'Readonly preflight; caller rechecks ownership/postimage at restoration.' };
  } catch (e) { return { status: 'FAIL', reason: common.redact(e.message) }; }
}
module.exports = { validate, validateContract, parseMode, parseOptions, sourceSnapshot, rollbackGuard, changes, validSnapshot, equal, artifact, readablePng };
if (require.main === module) {
  try {
    const o = parseOptions(process.argv.slice(2), ['root', 'contract', 'bundle']);
    const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
    const verdict = validate(o.root, read(o.contract), read(o.bundle));
    process.stdout.write(JSON.stringify(verdict) + '\n');
    process.exitCode = verdict.completion === 'PASS' ? 0 : 1;
  } catch (e) { process.stdout.write(JSON.stringify({ integrity: 'FAIL', completion: 'FAIL', errors: [common.redact(e.message)] }) + '\n'); process.exitCode = 1; }
}

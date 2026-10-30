#!/usr/bin/env node
/**
 * P14 candidate manifest: binds ONE demo candidate to an exact snapshot —
 * git SHA, source identity, Flyway head, spec + contract digests, the
 * per-gate evidence pointers, and the device-association digests — so no
 * rehearsal can mix artifacts from different runtime snapshots.
 *
 *   node scripts/ecosystem-release-manifest.mjs            → verify consistency, print manifest
 *   node scripts/ecosystem-release-manifest.mjs --out dir  → also write candidate-manifest.json there
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureSourceIdentity } from './ecosystem-source-identity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const outIdx = process.argv.indexOf('--out');
const outDir = outIdx >= 0 ? process.argv[outIdx + 1] : null;
// --exclude <dir>: skip an evidence dir mid-flight (the running gate's own
// dir holds fresh source-before beside a stale source-after — a drift
// false-positive by construction; its completed report binds next run).
const exIdx = process.argv.indexOf('--exclude');
const excludeDir = exIdx >= 0 ? path.resolve(process.argv[exIdx + 1]) : null;

// ── candidate identity ────────────────────────────────────────────────
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
// Untracked lines count too — captureSourceIdentity hashes `--others`, so a
// tree whose only changes are untracked is NOT clean: gitSha alone cannot
// reproduce sourceHash.
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter((l) => l.length > 0).length > 0;
const source = captureSourceIdentity(root);

const migDir = 'java-services/restful-api/src/main/resources/db/migration';
const versions = fs.readdirSync(path.join(root, migDir))
  .map((f) => /^V(\d+)__/.exec(f)?.[1]).filter(Boolean).map(Number);
const flywayHead = Math.max(...versions);

const specDigest = sha256(read('contracts/ecosystem/openapi.json'));
const contractDigest = sha256(read('contracts/ecosystem/domain-contracts.md'));
const allowlistDigest = sha256(read('contracts/ecosystem/contract-allowlist.json'));

// ── gate evidence pointers ────────────────────────────────────────────
const evRoot = path.join(root, 'artifacts/verification');
const gatesEvidence = [];
if (fs.existsSync(evRoot)) {
  for (const dir of fs.readdirSync(evRoot)) {
    if (excludeDir && path.resolve(evRoot, dir) === excludeDir) continue;
    const reportPath = path.join(evRoot, dir, 'report.json');
    const beforePath = path.join(evRoot, dir, 'source-before.json');
    const afterPath = path.join(evRoot, dir, 'source-after.json');
    if (!fs.existsSync(reportPath)) continue;
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const before = fs.existsSync(beforePath) ? JSON.parse(fs.readFileSync(beforePath, 'utf8')) : null;
    const after = fs.existsSync(afterPath) ? JSON.parse(fs.readFileSync(afterPath, 'utf8')) : null;
    const stable = before && after
      ? before.sha256 === after.sha256
      : 'unknown'; // evidence predates the source-stability mechanism
    gatesEvidence.push({
      evidenceDir: `artifacts/verification/${dir}`,
      gate: report.gate, verdict: report.verdict, target: report.target,
      counts: report.counts ?? null,
      sourceStable: stable, sourceHash: after?.sha256 ?? null,
      gitSha: report.identity?.gitSha ?? null,
      reportDigest: sha256(fs.readFileSync(reportPath)),
      mtimeMs: fs.statSync(reportPath).mtimeMs,
      checkedAt: report.identity?.checkedAt ?? null,
    });
  }
}

// Per gate, only the newest evidence binds the candidate — older runs
// (review rounds, repair iterations) stay listed as superseded history.
// Newest = checkedAt (the report's own timestamp), mtime as fallback.
const latestByGate = new Map();
const newestKey = (ev) => ev.checkedAt ?? String(ev.mtimeMs);
for (const ev of gatesEvidence) {
  const prev = latestByGate.get(ev.gate);
  if (!prev || newestKey(ev) > newestKey(prev)) latestByGate.set(ev.gate, ev);
}
const isAncestor = (sha) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, gitSha], { cwd: root, stdio: 'pipe' });
    return true;
  } catch { return false; }
};
for (const ev of gatesEvidence) {
  const latest = latestByGate.get(ev.gate);
  ev.superseded = ev !== latest;
  if (ev.superseded) continue;
  // A gate's newest run on drifting source is never valid evidence;
  // missing source files means the gate predates the mechanism —
  // recorded as unknown, not silently trusted.
  assert.notEqual(ev.sourceStable, false, `${ev.evidenceDir}: gate ran on drifting source — evidence invalid`);
  // Whitelist PASS only — PASS_PARTIAL, BLOCKED_CAPABILITY, NOT_RUN and
  // fabricated verdicts never bind as full-gate evidence.
  assert.equal(ev.verdict, 'PASS', `${ev.evidenceDir}: latest verdict ${ev.verdict} — only PASS binds`);
  // Cross-run snapshot honesty: phase gates legitimately ran on their own
  // commits, so "one candidate" means evidence on THIS commit or a proven
  // ancestor — never a descendant, sibling branch, or unverifiable source.
  if (ev.gitSha) {
    ev.onCandidate = ev.gitSha === gitSha || ev.sourceHash === source.sha256;
    ev.ancestor = ev.gitSha === gitSha || isAncestor(ev.gitSha);
    assert.ok(ev.ancestor, `${ev.evidenceDir}: gitSha ${ev.gitSha} is not an ancestor of ${gitSha} — evidence from a different runtime`);
    ev.stale = !ev.onCandidate;
  } else if (ev.sourceHash) {
    ev.onCandidate = ev.sourceHash === source.sha256;
    ev.stale = !ev.onCandidate;
  } else {
    // No gitSha and no sourceHash — pre-mechanism or fabricated; binds
    // only flagged, never silently.
    ev.unverifiable = true;
    ev.stale = true;
  }
}
const bound = [...latestByGate.values()];
const staleBound = bound.filter((e) => e.stale);
assert.ok(gatesEvidence.length >= 10, `expected >=10 gate evidence dirs, found ${gatesEvidence.length}`);

// ── device association digests ────────────────────────────────────────
const devices = {
  aasa: sha256(read('frontend/public/.well-known/apple-app-site-association')),
  assetlinks: sha256(read('frontend/public/.well-known/assetlinks.json')),
  appJson: sha256(read('mobile/app.json')),
  blocked: ['devices-android', 'devices-ios'],
};

// ── rehearsal artifacts (P14 drill/probe outputs live outside report.json
// gate evidence — bind their digests too when present) ─────────────────
const demoDir = 'artifacts/verification/demo';
const rehearsal = {};
if (fs.existsSync(path.join(root, demoDir))) {
  for (const f of fs.readdirSync(path.join(root, demoDir))) {
    if (!/^(backup-drill|host-probe|ops-envelope)\.json$/.test(f) && !/^demo-.*\.dump\.sha256$/.test(f)) continue;
    const p = path.join(root, demoDir, f);
    rehearsal[f] = { sha256: sha256(fs.readFileSync(p)), bytes: fs.statSync(p).size };
  }
}

const manifest = {
  candidate: { gitSha, sourceHash: source.sha256, sourceFiles: source.fileCount, dirtyWorktree: dirty, flywayHead, specDigest, contractDigest, allowlistDigest },
  evidenceSummary: {
    gatesBound: bound.length,
    onCandidateSnapshot: bound.filter((e) => e.onCandidate).length,
    staleAncestorEvidence: staleBound.map((e) => e.evidenceDir),
    unverifiableSource: bound.filter((e) => e.unverifiable).map((e) => e.evidenceDir),
    blockedCases: bound.reduce((s, e) => s + (e.counts?.blocked ?? 0), 0),
    nonRequiredFailures: bound.reduce((s, e) => s + (e.counts?.failed ?? 0), 0),
    supersededRuns: gatesEvidence.filter((e) => e.superseded).length,
  },
  rehearsalArtifacts: rehearsal,
  gates: gatesEvidence.sort((a, b) => a.gate.localeCompare(b.gate)),
  devices,
  generatedAt: new Date().toISOString(),
};

// A releasable candidate is never bound to a dirty worktree — the field
// is recorded so the freeze-time caller can refuse it; the verify leg
// still proves evidence consistency on a dirty tree.
if (dirty) {
  console.error('warning: worktree dirty — this manifest is NOT a releasable candidate');
}
if (staleBound.length > 0) {
  console.error(`warning: ${staleBound.length}/${bound.length} bound gates ran on ancestor snapshots, not this candidate — evidence is ancestor-valid, flagged stale`);
}
const unverifiable = bound.filter((e) => e.unverifiable);
if (unverifiable.length > 0) {
  console.error(`warning: ${unverifiable.length} bound gates carry no source identity (pre-mechanism evidence) — flagged unverifiable`);
}
if (Object.keys(rehearsal).length === 0) {
  console.error('warning: no drill/probe rehearsal artifacts under artifacts/verification/demo — live-surface rehearsal evidence not yet bound');
}

console.log(JSON.stringify(manifest, null, 2));
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.error(`manifest written: ${outDir}/candidate-manifest.json`);
}

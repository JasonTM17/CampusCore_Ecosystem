#!/usr/bin/env node
// Shared teardown helpers for the ecosystem-*-verify.mjs preview lanes.
//
// Windows leak fix: the spawned child's wrapper (cmd.exe / npm.cmd) can exit
// while a detached node grandchild keeps the preview port bound. Skipping
// already-exited children leaves that tree alive, so on win32 the tree kill
// must run for every tracked pid — a dead pid just makes taskkill fail
// harmlessly. Non-win32 keeps the existing SIGTERM behaviour.

import { execFileSync } from 'node:child_process';

export function preflightProjectVolumes(project, runCommand) {
  const result = runCommand('docker', [
    'volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`,
  ]);
  const ok = result.ok ?? result.status === 0;
  const output = result.out ?? result.stdout ?? '';
  if (!ok) throw new Error('Compose volume ownership preflight failed; refusing startup.');
  if (output.trim()) throw new Error('Refusing to adopt a Compose project that already contains volumes.');
  return true;
}

export function stopChildrenTree(children, { exec, platform } = {}) {
  const run = exec || execFileSync;
  const isWin = (platform ?? process.platform) === 'win32';
  for (const child of children) {
    if (isWin) {
      if (child && child.pid) {
        try {
          run('taskkill', ['/pid', String(child.pid), '/t', '/f'],
            { stdio: 'ignore' });
        } catch { /* best effort */ }
      }
      continue;
    }
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try { child.kill('SIGTERM'); } catch { /* best effort */ }
  }
}

// Ctrl+C / kill should tear the preview tree down too, not just the happy
// and caught-error paths.
export function installKillGuard(children, { exit, teardown } = {}) {
  const done = exit || ((code) => process.exit(code));
  const shutdown = (code, error) => {
    stopChildrenTree(children);
    if (error) console.error(error);
    try { teardown?.(); } catch { /* best effort while the process is stopping */ }
    done(code);
  };
  process.once('SIGINT', () => shutdown(130));
  process.once('SIGTERM', () => shutdown(143));
  process.once('uncaughtException', (error) => {
    shutdown(1, error);
  });
}

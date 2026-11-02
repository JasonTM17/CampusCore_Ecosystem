#!/usr/bin/env node
// Shared teardown helpers for the ecosystem-*-verify.mjs preview lanes.
//
// Windows leak fix: the spawned child's wrapper (cmd.exe / npm.cmd) can exit
// while a detached node grandchild keeps the preview port bound. Skipping
// already-exited children leaves that tree alive, so on win32 the tree kill
// must run for every tracked pid — a dead pid just makes taskkill fail
// harmlessly. Non-win32 keeps the existing SIGTERM behaviour.

import { execFileSync } from 'node:child_process';

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
export function installKillGuard(children, { exit } = {}) {
  const done = exit || ((code) => process.exit(code));
  process.once('SIGINT', () => { stopChildrenTree(children); done(130); });
  process.once('SIGTERM', () => { stopChildrenTree(children); done(143); });
  process.once('uncaughtException', (error) => {
    stopChildrenTree(children);
    console.error(error);
    done(1);
  });
}

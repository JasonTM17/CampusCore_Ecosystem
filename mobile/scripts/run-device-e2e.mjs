#!/usr/bin/env node
// Device e2e runner: requires `maestro` in PATH and a connected device.
// Device id comes from --device or ANDROID_DEVICE_ID / IOS_DEVICE_ID and is
// NEVER printed to stdout or artifacts.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes('--help')) {
  console.log(`run-device-e2e.mjs
  --platform android|ios   target platform (required)
  --device <id>            device id (or env ANDROID_DEVICE_ID / IOS_DEVICE_ID); never printed
  --flow <name>            maestro flow under .maestro/ (default: core)`);
  process.exit(0);
}
const platform = opt('platform');
const flow = opt('flow') ?? 'core';
const deviceId = opt('device') ?? (platform === 'ios' ? process.env.IOS_DEVICE_ID : process.env.ANDROID_DEVICE_ID);
const maestro = spawnSync('maestro', ['--version'], { encoding: 'utf8', shell: true });
if (maestro.status !== 0) {
  console.log('BLOCKED_CAPABILITY: maestro CLI not found in PATH.');
  process.exit(3);
}
if (!platform || !deviceId) {
  console.log(`BLOCKED_CAPABILITY: no ${platform ?? 'target'} device id supplied (--device or env var).`);
  process.exit(3);
}
const r = spawnSync('maestro', ['--device', deviceId, 'test', path.join(mobileDir, '.maestro', `${flow}.yaml`)], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);

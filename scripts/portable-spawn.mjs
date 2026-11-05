import { spawn, spawnSync } from 'node:child_process';

const BATCH_WRAPPER_RE = /\.(?:cmd|bat)$/i;

function commandProcessor(options) {
  return options.env?.ComSpec || process.env.ComSpec || 'cmd.exe';
}

export function spawnSyncPortable(command, args, options = {}, {
  platform = process.platform,
  spawnSyncImpl = spawnSync,
} = {}) {
  const direct = spawnSyncImpl(command, args, { ...options, shell: false });
  if (platform !== 'win32' || !['ENOENT', 'EINVAL'].includes(direct.error?.code)) return direct;

  // `call` lets cmd.exe invoke .cmd wrappers while keeping each argument separate.
  return spawnSyncImpl(commandProcessor(options), ['/d', '/s', '/c', 'call', command, ...args], {
    ...options,
    shell: false,
  });
}

export function spawnPortable(command, args, options = {}, {
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  if (platform !== 'win32' || !BATCH_WRAPPER_RE.test(command)) {
    return spawnImpl(command, args, { ...options, shell: false });
  }
  // A batch wrapper cannot start without cmd.exe and spawn reports that
  // failure asynchronously, so route known wrappers up front with shell mode
  // off; `call` keeps every argument a separate element of the argv list.
  return spawnImpl(commandProcessor(options), ['/d', '/s', '/c', 'call', command, ...args], {
    ...options,
    shell: false,
  });
}

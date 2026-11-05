import { spawnSync } from 'node:child_process';

export function spawnSyncPortable(command, args, options = {}, {
  platform = process.platform,
  spawnSyncImpl = spawnSync,
} = {}) {
  const direct = spawnSyncImpl(command, args, { ...options, shell: false });
  if (platform !== 'win32' || !['ENOENT', 'EINVAL'].includes(direct.error?.code)) return direct;

  const commandProcessor = options.env?.ComSpec || process.env.ComSpec || 'cmd.exe';
  // `call` lets cmd.exe invoke .cmd wrappers while keeping each argument separate.
  return spawnSyncImpl(commandProcessor, ['/d', '/s', '/c', 'call', command, ...args], {
    ...options,
    shell: false,
  });
}

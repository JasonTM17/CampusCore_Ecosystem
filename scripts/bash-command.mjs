import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveBashCommand({
  platform = process.platform,
  runGit = () => execFileSync('git', ['--exec-path'], { encoding: 'utf8' }),
  exists = existsSync,
} = {}) {
  if (platform !== 'win32') return 'bash';

  try {
    const gitExecPath = runGit().trim();
    if (!gitExecPath) return 'bash';
    const bashPath = path.win32.resolve(gitExecPath, '..', '..', '..', 'bin', 'bash.exe');
    if (exists(bashPath)) return bashPath;
  } catch {
    // Git Bash is optional when these scripts run outside Git for Windows.
  }

  return 'bash';
}

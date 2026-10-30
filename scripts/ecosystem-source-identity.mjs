import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['java-services', 'frontend', 'mobile', 'scripts', 'contracts',
  '.github', '.gitignore', 'docs/ecosystem', 'ops', 'database', 'docker-compose*.yml', 'Dockerfile', 'package*.json'];
const secretOrOutput = /(?:^|\/)(?:\.env[^/]*|node_modules|target|\.next|dist|build)(?:\/|$)|\.(?:pem|key|pfx|p12|dump|log)$/i;

/** Hash actual inputs, including unstaged and new source; never credential/output files. */
export function captureSourceIdentity(repo) {
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others',
    '--exclude-standard', '--', ...roots], { cwd: repo });
  const files = {};
  for (const name of [...new Set(names.toString('utf8').split('\0').filter(Boolean))].sort()) {
    if (secretOrOutput.test(name)) continue;
    const file = path.resolve(repo, name);
    const relative = path.relative(repo, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Source path escapes repository');
    if (!fs.existsSync(file)) { files[name] = 'DELETED'; continue; }
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Source symlink requires explicit scope: ${name}`);
    if (!fs.statSync(file).isFile()) continue;
    files[name] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { algorithm: 'sha256-raw-bytes-v1', sha256, fileCount: Object.keys(files).length, files };
}

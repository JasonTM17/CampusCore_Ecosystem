import fs from 'node:fs';
import path from 'node:path';

/**
 * Concatenate every .ts/.tsx under `dirRel` (recursive, sorted) so
 * source-reading tests keep working after per-screen file splits.
 * `match` (optional regex on the forward-slash relative path) narrows the set.
 */
export function readSources(rootDir, dirRel, match) {
  const base = path.join(rootDir, dirRel);
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) {
        const rel = path.relative(base, full).split(path.sep).join('/');
        if (!match || match.test(rel)) out.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(base);
  return out.join('\n');
}

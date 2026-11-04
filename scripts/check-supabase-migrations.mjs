// Supabase migration hygiene gate: catches timestamp, naming and content drift
// before CI replays the remote migration path. Cheap enough for every push.
//   - filenames must match  <14-digit timestamp>_<lowercase name>.sql
//   - timestamps must be unique and strictly ascending
//   - the descriptive name must be unique
//   - files must not be empty
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] || 'supabase/migrations';

const NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const files = readdirSync(join(process.cwd(), DIR)).filter(f => f.endsWith('.sql')).sort();

let failures = 0;
const fail = msg => { failures += 1; console.error(`FAIL  ${msg}`); };

const timestamps = new Map();
const names = new Map();
let previousTimestamp = null;
let previousFile = null;
for (const file of files) {
  const match = NAME.exec(file);
  if (!match) {
    fail(`bad migration filename: ${file}`);
    continue;
  }
  const [, timestamp, name] = match;
  if (timestamps.has(timestamp)) {
    fail(`duplicate migration timestamp ${timestamp}: ${timestamps.get(timestamp)} and ${file}`);
  }
  timestamps.set(timestamp, file);
  if (names.has(name)) {
    fail(`duplicate migration name ${name}: ${names.get(name)} and ${file}`);
  }
  names.set(name, file);
  if (previousTimestamp !== null && timestamp < previousTimestamp) {
    fail(`migration timestamp ${timestamp} in ${file} is older than ${previousFile}`);
  }
  previousTimestamp = timestamp;
  previousFile = file;
  if (statSync(join(process.cwd(), DIR, file)).size === 0) {
    fail(`empty migration file: ${file}`);
  }
}

console.log(`checked ${files.length} migration files in ${DIR}`);
if (failures === 0) {
  console.log('SUPABASE MIGRATION NAMES PASS');
} else {
  process.exitCode = 1;
}

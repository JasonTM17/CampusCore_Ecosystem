const help = process.argv.slice(2).length === 1
  && (process.argv[2] === '--help' || process.argv[2] === '-h');

console.error('Retired: this historical deployment poller is disabled. No network requests are made.');
if (help) {
  console.log('Usage: node scripts/wait-prod-section-search.mjs --help');
  process.exitCode = 0;
} else {
  console.error('Use an approved local verification workflow for current checks.');
  process.exitCode = 2;
}

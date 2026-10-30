import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..');

const excludedDirectoryNames = new Set([
  '.agentkit',
  '.agents',
  '.cache',
  '.claude',
  '.codex',
  '.cursor',
  '.data',
  '.devin',
  '.dsh',
  '.expo',
  '.gemini',
  '.git',
  '.grok',
  '.idea',
  '.mimosa',
  '.next',
  '.nyc_output',
  '.omp',
  '.opencode',
  '.playwright-mcp',
  '.turbo',
  '.vercel',
  '.video_agent',
  '.vscode',
  '.workbuddy-ai',
  '.zcode',
  'artifacts',
  'backups',
  'build',
  'coverage',
  'designs',
  'dist',
  'dogfood-output',
  'frontend-scan',
  'generated',
  'logs',
  'node_modules',
  'out',
  'plans',
  'playwright-report',
  'reports',
  'scratch',
  'secrets',
  'target',
  'test-results',
  'tinymce',
  'tmp',
]);

const textLikeFilePattern =
  /\.(?:cjs|css|example|html|js|json|jsx|md|mdx|mjs|mts|scss|sh|sql|test\.js|toml|ts|tsx|txt|yml|yaml)$/iu;

const secretFileNamePattern =
  /^\.env(?:\..+)?$|\.env$|^auth\.json$|^credentials\.json$|^secrets(?:\..+)?\.json$|^client_secret.*\.json$|^service[-_]account.*\.json$|^.*-service[-_]account.*\.json$|^oauth.*\.json$|^google-services\.json$/iu;
const publicFileSuffixPattern = /\.(?:example|sample|template|pub)$/iu;

const cp = String.fromCodePoint;
const latin1LeadRange = `[${cp(0x00c2)}-${cp(0x00c6)}]`;
const threeByteLeadRange = `[${cp(0x00e0)}-${cp(0x00ef)}]`;
const continuationRange = `[${cp(0x0080)}-${cp(0x00bf)}]`;

const mojibakeMarkers = [
  {
    label: 'replacement character',
    pattern: new RegExp(cp(0xfffd), 'u'),
  },
  {
    label: 'UTF-8 two-byte sequence read as Latin-1',
    pattern: new RegExp(`${latin1LeadRange}${continuationRange}`, 'u'),
  },
  {
    label: 'UTF-8 three-byte sequence read as Latin-1',
    pattern: new RegExp(
      `${threeByteLeadRange}${continuationRange}${continuationRange}`,
      'u',
    ),
  },
  {
    label: 'Vietnamese UTF-8 bytes decoded as Latin-1',
    pattern: new RegExp(`${cp(0x00e1)}[${cp(0x00ba)}${cp(0x00bb)}]`, 'u'),
  },
  {
    label: 'smart punctuation mojibake',
    pattern: new RegExp(`${cp(0x00e2)}${cp(0x20ac)}`, 'u'),
  },
];

const markerExemptions = new Map([
  [
    'mobile/tests/assistant-xhr-transport.test.mjs',
    new Set(['replacement character']),
  ],
]);

const localizedKeyPattern =
  /\b(?:body|copy|cta|description|label|message|name|semester|subject|text|title)(?:En|Vi)?\b|['"]vi['"]\s*:/iu;
const suspiciousQuestionMarkPattern = /\p{L}\?\p{L}/u;

function main() {
  const errors = [];

  for (const filePath of walkRepo(repoRoot)) {
    scanFile(filePath, errors);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Text encoding guard passed.');
}

function scanFile(filePath, errors) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/gu, '/');
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);

  lines.forEach((line, index) => {
    for (const { label, pattern } of mojibakeMarkers) {
      if (pattern.test(line) && !isMarkerExempt(relativePath, label)) {
        errors.push(
          `${relativePath}:${index + 1} contains likely mojibake marker: ${label}`,
        );
      }
    }

    if (
      localizedKeyPattern.test(line) &&
      suspiciousQuestionMarkPattern.test(line) &&
      !isAllowedQuestionMarkLine(line)
    ) {
      errors.push(
        `${relativePath}:${index + 1} contains a suspicious question mark inside localized text`,
      );
    }
  });
}

function isMarkerExempt(relativePath, label) {
  return markerExemptions.get(relativePath)?.has(label) === true;
}

function isAllowedQuestionMarkLine(line) {
  return (
    /\?\?|\?:|\?\.|https?:\/\//u.test(line) ||
    /password\?|forgot|question|query|searchParams|URLSearchParams/iu.test(line) ||
    /\p{L}\?\p{L}[\p{L}\p{N}_-]*=/u.test(line) ||
    /\/[^\n/]*\?[^\n/]*\/[dgimsuvy]*\b/u.test(line)
  );
}

function walkRepo(currentDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (excludedDirectoryNames.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRepo(fullPath));
      continue;
    }

    if (isSecretFile(entry.name)) {
      continue;
    }

    if (isTextLikeFile(fullPath) || entry.name === 'Dockerfile') {
      files.push(fullPath);
    }
  }

  return files;
}

function isSecretFile(fileName) {
  return (
    secretFileNamePattern.test(fileName) &&
    !publicFileSuffixPattern.test(fileName)
  );
}

function isTextLikeFile(filePath) {
  return textLikeFilePattern.test(filePath);
}

main();

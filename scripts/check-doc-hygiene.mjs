import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const docRoots = [
  'README.md',
  'README.en.md',
  'README.vi.md',
  'docs',
  '.github',
];

const requiredFiles = [
  'docs/assets/github-social-preview.png',
  'docs/assets/github-social-preview.svg',
  'docs/assets/screenshots/campuscore-home-en.png',
  'docs/assets/screenshots/campuscore-home-vi.png',
  'docs/releases/TEMPLATE.md',
  'docs/releases/v1.4.0.md',
];

const requiredReadmeSnippets = [
  './docs/assets/screenshots/campuscore-home-en.png',
  './docs/releases/v1.4.0.md',
];

const mojibakeMarkers = ['Ã', 'Ä', 'Æ', '\uFFFD'];
const textFilePattern = /\.(?:md|mdx|yml|yaml)$/iu;

function main() {
  const errors = [];

  assertRequiredFiles(errors);
  assertReadmeSnippets(errors);
  assertNoMojibake(errors);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Documentation hygiene guard passed.');
}

function assertRequiredFiles(errors) {
  for (const relativePath of requiredFiles) {
    if (!fs.existsSync(path.join(repoRoot, relativePath))) {
      errors.push(`${relativePath} is missing`);
    }
  }
}

function assertReadmeSnippets(errors) {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  for (const snippet of requiredReadmeSnippets) {
    if (!readme.includes(snippet)) {
      errors.push(`README.md is missing required snippet: ${snippet}`);
    }
  }
}

function assertNoMojibake(errors) {
  for (const filePath of docRoots.flatMap((entry) => walk(path.join(repoRoot, entry)))) {
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/gu, '/');
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      for (const marker of mojibakeMarkers) {
        if (line.includes(marker)) {
          errors.push(
            `${relativePath}:${index + 1} contains likely mojibake marker ${JSON.stringify(marker)}`,
          );
        }
      }
    });
  }
}

function walk(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(filePath)
      .flatMap((entry) => walk(path.join(filePath, entry)));
  }

  return textFilePattern.test(filePath) ? [filePath] : [];
}

main();

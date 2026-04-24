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
  'https://github.com/JasonTM17/CampusCore_FullStack_Individual/releases/tag/v1.4.0',
];

const mojibakeMarkers = ['Ã', 'Ä', 'Æ', '\uFFFD'];
const textFilePattern = /\.(?:md|mdx|yml|yaml)$/iu;
const markdownLinkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;

function main() {
  const errors = [];

  assertRequiredFiles(errors);
  assertReadmeSnippets(errors);
  assertNoMojibake(errors);
  assertMarkdownLinks(errors);

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

function assertMarkdownLinks(errors) {
  for (const filePath of docRoots.flatMap((entry) => walk(path.join(repoRoot, entry)))) {
    if (!/\.mdx?$/iu.test(filePath)) {
      continue;
    }

    const relativePath = path.relative(repoRoot, filePath).replace(/\\/gu, '/');
    const lines = stripCodeFences(fs.readFileSync(filePath, 'utf8')).split(/\r?\n/u);

    lines.forEach((line, index) => {
      for (const match of line.matchAll(markdownLinkPattern)) {
        const rawTarget = match[1].trim();
        const target = normalizeMarkdownTarget(rawTarget);

        if (shouldSkipLink(target)) {
          continue;
        }

        const targetWithoutHash = target.split('#')[0];
        if (!targetWithoutHash) {
          continue;
        }

        const resolvedPath = path.resolve(path.dirname(filePath), targetWithoutHash);
        if (!resolvedPath.startsWith(repoRoot) || !fs.existsSync(resolvedPath)) {
          errors.push(
            `${relativePath}:${index + 1} has broken local link ${JSON.stringify(rawTarget)}`,
          );
        }
      }
    });
  }
}

function stripCodeFences(markdown) {
  let inFence = false;
  return markdown
    .split(/\r?\n/u)
    .map((line) => {
      if (/^\s*```/u.test(line)) {
        inFence = !inFence;
        return '';
      }

      return inFence ? '' : line;
    })
    .join('\n');
}

function normalizeMarkdownTarget(target) {
  const withoutTitle = target.replace(/\s+"[^"]*"$/u, '');
  if (withoutTitle.startsWith('<') && withoutTitle.endsWith('>')) {
    return withoutTitle.slice(1, -1);
  }

  return withoutTitle;
}

function shouldSkipLink(target) {
  return (
    target.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:/iu.test(target) ||
    target.startsWith('//')
  );
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

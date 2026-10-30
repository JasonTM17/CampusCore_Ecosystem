import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_IMAGE_BUDGET = Object.freeze({
  maxBytes: 300 * 1024,
  maxLongEdge: 1600,
  modernExtension: '.webp',
  fallbackExtensions: Object.freeze(['.jpg', '.jpeg']),
});

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const BANNER_REFERENCE_PATTERN = /\/images\/banners\/([^/\\\s"'?#)]+)/gi;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

export function extractBannerReferences(source) {
  return [...source.matchAll(BANNER_REFERENCE_PATTERN)].map((match) => `/images/banners/${match[1]}`);
}

async function listSourceFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(entryPath));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }

  return files;
}

export async function collectBannerReferences(sourceDirectory) {
  const references = new Set();
  const sourceFiles = await listSourceFiles(sourceDirectory);

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8');
    for (const reference of extractBannerReferences(source)) references.add(reference);
  }

  return [...references].sort();
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

export function readWebpDimensions(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkLength = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkLength > buffer.length) return null;

    if (chunkType === 'VP8X' && chunkLength >= 10) {
      return {
        width: readUInt24LE(buffer, dataOffset + 4) + 1,
        height: readUInt24LE(buffer, dataOffset + 7) + 1,
      };
    }

    if (chunkType === 'VP8 ' && chunkLength >= 10) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }

    if (chunkType === 'VP8L' && chunkLength >= 5 && buffer[dataOffset] === 0x2f) {
      const b1 = buffer[dataOffset + 1];
      const b2 = buffer[dataOffset + 2];
      const b3 = buffer[dataOffset + 3];
      const b4 = buffer[dataOffset + 4];
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      };
    }

    offset = dataOffset + chunkLength + (chunkLength % 2);
  }

  return null;
}

export function validateBannerBudget(references, assets, budget = PUBLIC_IMAGE_BUDGET) {
  const errors = [];
  const checkedRenditions = new Set();
  const checkedReferences = new Set(references);

  const checkRendition = (filename, reference) => {
    if (checkedRenditions.has(filename)) return;
    checkedRenditions.add(filename);

    const rendition = assets.get(filename);
    if (!rendition) {
      errors.push(`Missing ${budget.modernExtension} rendition for ${reference}: ${filename}`);
      return;
    }

    if (rendition.bytes > budget.maxBytes) {
      errors.push(`${filename} is ${rendition.bytes} bytes; limit is ${budget.maxBytes} bytes`);
    }

    if (!rendition.width || !rendition.height) {
      errors.push(`Unable to read dimensions for ${filename}`);
    } else if (Math.max(rendition.width, rendition.height) > budget.maxLongEdge) {
      errors.push(`${filename} has a ${Math.max(rendition.width, rendition.height)} px long edge; limit is ${budget.maxLongEdge} px`);
    }
  };

  for (const reference of checkedReferences) {
    const match = /^\/images\/banners\/([^/\\\s"'?#)]+)$/i.exec(reference);
    if (!match) {
      errors.push(`Invalid banner reference: ${reference}`);
      continue;
    }

    const filename = match[1];
    const extension = path.extname(filename).toLowerCase();
    if (!assets.has(filename)) {
      errors.push(`Reference points to missing file: ${reference}`);
      continue;
    }

    if (extension === budget.modernExtension) {
      const fallback = `${path.parse(filename).name}.jpg`;
      if (!assets.has(fallback)) errors.push(`Missing JPEG fallback for ${reference}: ${fallback}`);
      checkRendition(filename, reference);
    } else if (budget.fallbackExtensions.includes(extension)) {
      checkRendition(`${path.parse(filename).name}${budget.modernExtension}`, reference);
    } else {
      errors.push(`Unsupported banner file type: ${reference}`);
    }
  }

  return { errors, renditionCount: checkedRenditions.size };
}

async function readBannerAssets(bannerDirectory) {
  const assets = new Map();
  const entries = await readdir(bannerDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!PUBLIC_IMAGE_BUDGET.fallbackExtensions.includes(extension)
      && extension !== PUBLIC_IMAGE_BUDGET.modernExtension) continue;

    const fullPath = path.join(bannerDirectory, entry.name);
    if (extension === PUBLIC_IMAGE_BUDGET.modernExtension) {
      const buffer = await readFile(fullPath);
      const dimensions = readWebpDimensions(buffer);
      assets.set(entry.name, { bytes: buffer.length, ...dimensions });
    } else {
      const fileInfo = await stat(fullPath);
      assets.set(entry.name, { bytes: fileInfo.size });
    }
  }

  return assets;
}

export async function checkPublicImageBudget(repositoryRoot = REPOSITORY_ROOT) {
  const bannerDirectory = path.join(repositoryRoot, 'frontend', 'public', 'images', 'banners');
  const sourceDirectory = path.join(repositoryRoot, 'frontend', 'src');
  const [references, assets] = await Promise.all([
    collectBannerReferences(sourceDirectory),
    readBannerAssets(bannerDirectory),
  ]);
  const validation = validateBannerBudget(references, assets);
  return { references, ...validation };
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const result = await checkPublicImageBudget();
  if (result.errors.length) {
    for (const error of result.errors) console.error(`FAIL: ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `PASS: ${result.references.length} distinct banner references; ${result.renditionCount} WebP renditions within ${PUBLIC_IMAGE_BUDGET.maxBytes} bytes and ${PUBLIC_IMAGE_BUDGET.maxLongEdge} px.`,
    );
  }
}

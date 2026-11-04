/*
 * This policy inventories executable container image references without Docker.
 * External references require a valid sha256 digest alongside the tag; exact
 * source-build outputs, scratch and the reviewed GHCR full-SHA interpolation
 * keep their contracts as the only documented exceptions.
 * KNOWN_MUTABLE is a temporary owner-pending baseline and must only shrink.
 * Every exception names its repository-relative file and exact reference.
 * Baseline entries are checked against the live inventory to catch stale grants.
 * New mutable references fail evaluation even when they appear in familiar files.
 * Parsing covers this repository's Compose, Dockerfile, workflow and Caddy forms.
 */

const LOCAL_BUILDS = Object.freeze([
  { file: 'docker-compose.yml', service: 'postgres', reference: 'student-management-ute-database:local' },
  { file: 'docker-compose.yml', service: 'rag-service', reference: 'student-management-ute-rag-service:local' },
  { file: 'docker-compose.yml', service: 'restful-api', reference: 'student-management-ute-restful-api:local' },
  { file: 'docker-compose.yml', service: 'web', reference: 'student-management-ute-frontend:local' },
  {
    file: 'docker-compose.e2e.yml',
    service: 'restful-api',
    reference: '${E2E_CORE_API_IMAGE:-student-management-ute-restful-api:e2e-local}',
  },
]);

const GHCR_COMPONENTS = Object.freeze([
  { service: 'postgres', component: 'database' },
  { service: 'rag-service', component: 'rag-service' },
  { service: 'restful-api', component: 'restful-api' },
  { service: 'web', component: 'frontend' },
]);
const GHCR_TAG_CONTRACT = '${CAMPUSCORE_IMAGE_TAG:?Set CAMPUSCORE_IMAGE_TAG to a reviewed full commit SHA}';

// No open grants: every external executable reference carries a resolved digest.
export const KNOWN_MUTABLE = Object.freeze([]);

function normalizeFile(file) {
  return String(file).replaceAll('\\', '/').replace(/^\.\//, '');
}

function scalarValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    const inner = trimmed.slice(1, -1);
    return quote === "'" ? inner.replaceAll("''", "'") : inner.replaceAll('\\"', '"');
  }

  return trimmed.replace(/\s+#.*$/, '').trim();
}

function record(file, service, reference, line) {
  return {
    file: normalizeFile(file),
    service,
    reference: String(reference).trim(),
    line,
  };
}

function parseCompose(file, source) {
  const references = [];
  let servicesIndent = null;
  let currentService;

  source.split(/\r?\n/).forEach((line, index) => {
    const indentation = /^\s*/.exec(line)[0].length;
    const content = line.trim();
    if (!content || content.startsWith('#')) return;

    if (/^services\s*:\s*(?:#.*)?$/.test(content)) {
      servicesIndent = indentation;
      currentService = undefined;
      return;
    }

    if (servicesIndent === null) return;
    if (indentation <= servicesIndent) {
      servicesIndent = null;
      currentService = undefined;
      return;
    }

    const serviceMatch = new RegExp(`^ {${servicesIndent + 2}}([A-Za-z0-9][A-Za-z0-9_-]*)\\s*:\\s*(?:#.*)?$`).exec(line);
    if (serviceMatch) {
      currentService = serviceMatch[1];
      return;
    }

    const imageMatch = /^\s*image\s*:\s*(.*?)\s*$/.exec(line);
    if (imageMatch && currentService) {
      const reference = scalarValue(imageMatch[1]);
      if (reference) references.push(record(file, currentService, reference, index + 1));
    }
  });

  return references;
}

function parseDockerfile(file, source) {
  const references = [];

  source.split(/\r?\n/).forEach((line, index) => {
    const fromMatch = /^\s*FROM\s+(?:(?:--[^\s]+)\s+)*([^\s#]+)/i.exec(line);
    if (!fromMatch) return;

    const stageMatch = /\s+AS\s+([^\s#]+)/i.exec(line);
    references.push(record(file, stageMatch ? `stage:${stageMatch[1]}` : undefined, fromMatch[1], index + 1));
  });

  return references;
}

function parseWorkflow(file, source) {
  const references = [];
  let containerIndent = null;
  let servicesIndent = null;
  let currentService;

  source.split(/\r?\n/).forEach((line, index) => {
    const indentation = /^\s*/.exec(line)[0].length;
    const content = line.trim();
    if (!content || content.startsWith('#')) return;

    if (containerIndent !== null && indentation <= containerIndent) containerIndent = null;
    if (servicesIndent !== null && indentation <= servicesIndent) {
      servicesIndent = null;
      currentService = undefined;
    }

    const containerMatch = /^container\s*:\s*(.*?)\s*$/.exec(content);
    if (containerMatch) {
      const value = scalarValue(containerMatch[1]);
      if (value && value !== '{}' && value !== '[]') {
        references.push(record(file, 'container', value, index + 1));
      } else {
        containerIndent = indentation;
      }
      return;
    }

    if (/^services\s*:\s*(?:#.*)?$/.test(content)) {
      servicesIndent = indentation;
      currentService = undefined;
      return;
    }

    const imageMatch = /^image\s*:\s*(.*?)\s*$/.exec(content);
    if (imageMatch && containerIndent !== null && indentation > containerIndent) {
      const reference = scalarValue(imageMatch[1]);
      if (reference) references.push(record(file, 'container', reference, index + 1));
      return;
    }

    if (servicesIndent !== null && indentation > servicesIndent) {
      if (indentation === servicesIndent + 2) {
        const serviceMatch = /^([A-Za-z0-9][A-Za-z0-9_-]*)\s*:\s*(?:#.*)?$/.exec(content);
        currentService = serviceMatch?.[1];
      } else if (imageMatch && currentService) {
        const reference = scalarValue(imageMatch[1]);
        if (reference) references.push(record(file, currentService, reference, index + 1));
      }
    }
  });

  return references;
}

function parseCaddyDefault(file, source) {
  const match = /^\s*export\s+const\s+DEFAULT_CADDY_IMAGE\s*=\s*(['"])(.*?)\1\s*;?\s*$/m.exec(source);
  return match ? [record(file, 'DEFAULT_CADDY_IMAGE', match[2], source.slice(0, match.index).split(/\r?\n/).length)] : [];
}

export function parseReferences(filePath, fileText) {
  const file = normalizeFile(filePath);
  const name = file.split('/').at(-1);

  if (name.startsWith('docker-compose') && name.endsWith('.yml')) return parseCompose(file, fileText);
  if (name === 'Dockerfile' || name.startsWith('Dockerfile.') || name.endsWith('.Dockerfile')) {
    return parseDockerfile(file, fileText);
  }
  if (file.startsWith('.github/workflows/') && file.endsWith('.yml')) return parseWorkflow(file, fileText);
  if (file === 'scripts/caddy-validate.mjs') return parseCaddyDefault(file, fileText);
  return [];
}

function sameReference(left, right) {
  return normalizeFile(left.file) === normalizeFile(right.file)
    && left.service === right.service
    && left.reference === right.reference;
}

function isApprovedLocalBuild(reference) {
  return LOCAL_BUILDS.some((approved) => sameReference(reference, approved));
}

function isApprovedVariable(reference) {
  const component = GHCR_COMPONENTS.find(({ service }) => service === reference.service)?.component;
  return reference.file === 'docker-compose.rag.override.yml'
    && Boolean(component)
    && reference.reference === `ghcr.io/jasontm17/student-management-ute-${component}:${GHCR_TAG_CONTRACT}`;
}

export function classifyReference(reference, context = {}) {
  const value = String(reference).trim();
  const location = {
    ...context,
    file: context.file === undefined ? undefined : normalizeFile(context.file),
    reference: value,
  };

  if (value === 'scratch') return { classification: 'scratch' };
  if (/^.+@sha256:[0-9a-fA-F]{64}$/.test(value)) return { classification: 'digest-pinned' };
  if (isApprovedLocalBuild(location)) return { classification: 'approved-local-build' };
  if (isApprovedVariable(location)) return { classification: 'approved-variable' };

  return {
    classification: 'MUTABLE',
    reason: value.includes('@') ? 'digest must use @sha256 with 64 hexadecimal characters' : 'external image lacks an approved immutable reference',
  };
}

export function evaluateReferences(references, { knownMutable = KNOWN_MUTABLE } = {}) {
  const baseline = knownMutable.map((entry) => ({ ...entry, file: normalizeFile(entry.file) }));
  const issues = [];
  const evaluated = references.map((entry) => {
    const normalized = { ...entry, file: normalizeFile(entry.file) };
    const result = classifyReference(normalized.reference, normalized);
    const classified = { ...normalized, ...result };

    if (result.classification === 'MUTABLE') {
      const exception = baseline.find((item) => sameReference(normalized, item));
      if (!exception) {
        issues.push({
          type: 'unapproved-mutable-reference',
          file: normalized.file,
          service: normalized.service,
          reference: normalized.reference,
          reason: result.reason,
        });
      }
    }

    return classified;
  });

  for (const exception of baseline) {
    if (!references.some((entry) => sameReference(entry, exception))) {
      issues.push({
        type: 'stale-known-mutable',
        file: exception.file,
        service: exception.service,
        reference: exception.reference,
        reason: exception.reason,
      });
    }
  }

  return { ok: issues.length === 0, references: evaluated, issues };
}

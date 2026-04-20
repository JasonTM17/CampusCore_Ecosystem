import { spawn } from 'node:child_process';
import https from 'node:https';
import { promisify } from 'node:util';

const sleep = promisify(setTimeout);

const images = [
  'campuscore-backend',
  'campuscore-auth-service',
  'campuscore-notification-service',
  'campuscore-finance-service',
  'campuscore-academic-service',
  'campuscore-engagement-service',
  'campuscore-people-service',
  'campuscore-analytics-service',
  'campuscore-frontend',
];

const defaultDockerHubNamespace = 'nguyenson1710';
const defaultRegistries = ['ghcr', 'dockerhub'];

async function main() {
  const releaseTag = await resolveReleaseTag();
  const shortSha = await resolveShortSha();
  const ghcrNamespace = await resolveGhcrNamespace();
  const dockerHubNamespace =
    process.env.DOCKERHUB_NAMESPACE ||
    process.env.DOCKERHUB_USERNAME ||
    defaultDockerHubNamespace;
  const concurrency = positiveInteger(
    process.env.VERIFY_RELEASE_CONCURRENCY,
    4,
  );
  const timeoutMs = positiveInteger(
    process.env.VERIFY_RELEASE_TIMEOUT_MS,
    45_000,
  );
  const retries = nonNegativeInteger(process.env.VERIFY_RELEASE_RETRIES, 2);
  const registries = parseRegistries(process.env.VERIFY_RELEASE_REGISTRIES);

  const checks = [];
  for (const registry of registries) {
    const prefix =
      registry === 'ghcr'
        ? `ghcr.io/${ghcrNamespace}`
        : dockerHubNamespace;
    for (const image of images) {
      for (const tag of [releaseTag, shortSha, 'latest']) {
        checks.push({
          image,
          ref: `${prefix}/${image}:${tag}`,
          registry,
          tag,
        });
      }
    }
  }

  console.log(
    `[release-verify] Checking ${checks.length} manifests across ${registries.join(', ')}`,
  );
  console.log(`[release-verify] Release tag: ${releaseTag}`);
  console.log(`[release-verify] Short SHA: ${shortSha}`);
  console.log(`[release-verify] Concurrency: ${concurrency}`);
  console.log(`[release-verify] Timeout per attempt: ${timeoutMs}ms`);
  console.log(`[release-verify] Retries: ${retries}`);

  const results = await runPool(checks, concurrency, (check) =>
    verifyManifest(check, { retries, timeoutMs }),
  );
  const failures = results.filter((result) => !result.ok);

  printSummary(results);

  if (failures.length > 0) {
    console.error('[release-verify] Manifest verification failed:');
    for (const failure of failures) {
      console.error(
        `- ${failure.check.registry} ${failure.check.image}:${failure.check.tag} (${failure.check.ref})`,
      );
      console.error(`  ${failure.error}`);
    }
    process.exit(1);
  }

  console.log('[release-verify] All release manifests are available.');
}

async function verifyManifest(check, options) {
  let lastError = '';
  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    try {
      await inspectManifest(check.ref, options.timeoutMs);
      console.log(
        `[release-verify] ok ${check.registry} ${check.image}:${check.tag}`,
      );
      return { check, ok: true };
    } catch (error) {
      lastError = error.message;
      if (
        check.registry === 'dockerhub' &&
        isDockerHubRateLimit(error.message) &&
        (await verifyDockerHubTagViaApi(check, options.timeoutMs))
      ) {
        console.log(
          `[release-verify] ok dockerhub ${check.image}:${check.tag} via Docker Hub tag API after manifest rate limit`,
        );
        return { check, ok: true, rateLimitFallback: true };
      }

      if (attempt <= options.retries) {
        const backoffMs = Math.min(1_000 * attempt, 5_000);
        console.warn(
          `[release-verify] retry ${attempt}/${options.retries} ${check.ref}: ${error.message}`,
        );
        await sleep(backoffMs);
      }
    }
  }

  return { check, error: lastError, ok: false };
}

async function verifyDockerHubTagViaApi(check, timeoutMs) {
  const namespace =
    process.env.DOCKERHUB_NAMESPACE ||
    process.env.DOCKERHUB_USERNAME ||
    defaultDockerHubNamespace;
  const url = `https://hub.docker.com/v2/repositories/${namespace}/${check.image}/tags/${check.tag}`;

  try {
    const response = await fetchJson(url, timeoutMs);
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (error) {
    console.warn(
      `[release-verify] Docker Hub tag API fallback failed for ${check.image}:${check.tag}: ${error.message}`,
    );
    return false;
  }
}

async function inspectManifest(ref, timeoutMs) {
  try {
    await runCommand('docker', ['manifest', 'inspect', ref], { timeoutMs });
    return;
  } catch (manifestError) {
    await runCommand('docker', ['buildx', 'imagetools', 'inspect', ref], {
      cause: manifestError.message,
      timeoutMs,
    });
  }
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGKILL');
      reject(
        new Error(
          `${command} ${args.join(' ')} timed out after ${options.timeoutMs}ms`,
        ),
      );
    }, options.timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 2_000) {
        stderr = stderr.slice(-2_000);
      }
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }

      const prefix = options.cause ? `${options.cause}; fallback failed: ` : '';
      reject(
        new Error(
          `${prefix}${command} ${args.join(' ')} exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
        ),
      );
    });
  });
}

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CampusCore-release-verifier',
        },
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0 });
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error(`GET ${url} timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
  });
}

function isDockerHubRateLimit(message) {
  return /toomanyrequests|too many requests|rate limit|429/iu.test(message);
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()),
  );
  return results;
}

function printSummary(results) {
  const byRegistry = new Map();
  for (const result of results) {
    const current = byRegistry.get(result.check.registry) ?? {
      failed: 0,
      passed: 0,
    };
    if (result.ok) {
      current.passed += 1;
    } else {
      current.failed += 1;
    }
    byRegistry.set(result.check.registry, current);
  }

  for (const [registry, summary] of byRegistry.entries()) {
    console.log(
      `[release-verify] ${registry}: ${summary.passed} passed, ${summary.failed} failed`,
    );
  }
}

function parseRegistries(value) {
  if (!value) {
    return defaultRegistries;
  }

  const registries = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const invalid = registries.filter(
    (registry) => !defaultRegistries.includes(registry),
  );
  if (invalid.length > 0) {
    throw new Error(
      `VERIFY_RELEASE_REGISTRIES contains unsupported values: ${invalid.join(', ')}`,
    );
  }
  return [...new Set(registries)];
}

function positiveInteger(value, defaultValue) {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function nonNegativeInteger(value, defaultValue) {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received: ${value}`);
  }
  return parsed;
}

async function resolveReleaseTag() {
  if (process.env.RELEASE_TAG) {
    return process.env.RELEASE_TAG;
  }

  const tagOutput = await runGit(['tag', '--points-at', 'HEAD', '--list', 'v*.*.*']);
  const tags = tagOutput
    .split(/\r?\n/u)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .sort(compareSemverTags);
  if (tags.length === 0) {
    throw new Error(
      'RELEASE_TAG is required when HEAD does not point at a semver tag.',
    );
  }
  return tags.at(-1);
}

async function resolveShortSha() {
  if (process.env.RELEASE_SHORT_SHA) {
    return process.env.RELEASE_SHORT_SHA;
  }
  return runGit(['rev-parse', '--short', 'HEAD']);
}

async function resolveGhcrNamespace() {
  if (process.env.GHCR_NAMESPACE) {
    return process.env.GHCR_NAMESPACE.toLowerCase();
  }

  const remote = await runGit(['remote', 'get-url', 'origin']);
  const match = remote.match(/github\.com[:/](?<owner>[^/]+)\//iu);
  if (!match?.groups?.owner) {
    throw new Error(
      'GHCR_NAMESPACE is required when the GitHub remote owner cannot be detected.',
    );
  }
  return match.groups.owner.toLowerCase();
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(
        new Error(
          `git ${args.join(' ')} exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
        ),
      );
    });
  });
}

function compareSemverTags(left, right) {
  const leftParts = parseSemverTag(left);
  const rightParts = parseSemverTag(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return left.localeCompare(right);
}

function parseSemverTag(tag) {
  const match = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/u);
  if (!match) {
    return [0, 0, 0];
  }
  return match.slice(1).map(Number);
}

main().catch((error) => {
  console.error(`[release-verify] ${error.message}`);
  process.exit(1);
});

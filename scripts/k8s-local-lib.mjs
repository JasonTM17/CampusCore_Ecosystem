import { appendFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '..');
export const namespace = process.env.K8S_NAMESPACE ?? 'campuscore';
export const localPort = Number(process.env.K8S_LOCAL_EDGE_PORT ?? '8080');
export const baseURL = `http://127.0.0.1:${localPort}`;
export const overlayDir = path.join(repoRoot, 'k8s', 'overlays', 'docker-desktop');
export const bootstrapDir = path.join(repoRoot, 'k8s', 'bootstrap');
export const edgeSupervisorScriptPath = path.join(
  repoRoot,
  'scripts',
  'k8s-local-edge-supervisor.mjs',
);
export const edgeStatePath = path.join(
  repoRoot,
  'frontend',
  'test-results',
  'k8s-local-edge-state.json',
);
export const edgeHealthUrls = {
  health: `${baseURL}/health`,
  login: `${baseURL}/login`,
  docs: `${baseURL}/api/docs`,
  readiness: `${baseURL}/api/v1/health/readiness`,
  authContext: `${baseURL}/api/v1/internal/auth-context/users/test-user`,
  peopleContext: `${baseURL}/api/v1/internal/people-context/users/test-user`,
};

export const infraDeployments = ['postgres', 'redis', 'rabbitmq', 'minio'];
export const runtimeDeployments = [
  'core-api',
  'auth-service',
  'notification-service',
  'finance-service',
  'academic-service',
  'engagement-service',
  'people-service',
  'analytics-service',
  'frontend',
  'nginx',
];

export const bootstrapJobs = [
  { name: 'core-api-init', waitForDeployment: 'core-api' },
  { name: 'auth-service-init', waitForDeployment: 'auth-service' },
  { name: 'notification-service-init', waitForDeployment: 'notification-service' },
  { name: 'finance-service-init', waitForDeployment: 'finance-service' },
  { name: 'academic-service-init', waitForDeployment: 'academic-service' },
  { name: 'engagement-service-init', waitForDeployment: 'engagement-service' },
  { name: 'people-service-init', waitForDeployment: 'people-service' },
  { name: 'analytics-service-init', waitForDeployment: 'analytics-service' },
];

export async function runCli(task) {
  try {
    await task();
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  }
}

export function resolveLogsDir(name) {
  return path.join(repoRoot, 'frontend', 'test-results', name);
}

export async function prepareLogs(name) {
  const logsDir = resolveLogsDir(name);
  await rm(logsDir, { recursive: true, force: true });
  await mkdir(logsDir, { recursive: true });
  return logsDir;
}

export async function runPreflight() {
  await run(process.execPath, [path.join(repoRoot, 'scripts', 'run-k8s-preflight.mjs')]);
}

export async function ensureClusterAvailable() {
  try {
    await run('kubectl', ['cluster-info'], { captureOutput: true, timeoutMs: 30000 });
  } catch {
    throw new Error(
      'Kubernetes cluster is not reachable. Enable Docker Desktop Kubernetes and make sure kubectl points to docker-desktop before running the local K8s scripts.',
    );
  }
}

export async function assertNamespaceHasRuntimeStack() {
  if (!(await namespaceExists())) {
    throw new Error(
      `Namespace ${namespace} does not exist. Run node scripts/run-k8s-local-deploy.mjs first, then reopen the local edge.`,
    );
  }

  const state = await summarizeRuntimeState();
  const missingDeployments = runtimeDeployments.filter(
    (deployment) => !state.deployments.includes(`deployment.apps/${deployment}`),
  );

  if (missingDeployments.length > 0) {
    throw new Error(
      `Namespace ${namespace} is missing runtime deployments: ${missingDeployments.join(
        ', ',
      )}. Run node scripts/run-k8s-local-deploy.mjs before opening the local edge.`,
    );
  }
}

export async function namespaceExists() {
  const output = await run(
    'kubectl',
    ['get', 'namespace', namespace, '-o', 'name'],
    { captureOutput: true, allowFailure: true, timeoutMs: 30000 },
  );
  return Boolean(output?.trim());
}

export async function listNamespacedResources() {
  if (!(await namespaceExists())) {
    return [];
  }

  const output = await run(
    'kubectl',
    [
      '-n',
      namespace,
      'get',
      'deployments,pods,services,jobs,pvc',
      '-o',
      'name',
    ],
    { captureOutput: true, allowFailure: true, timeoutMs: 30000 },
  );

  return normalizeOutputLines(output);
}

export async function assertNamespaceReadyForFreshDeploy() {
  if (process.env.K8S_REUSE_NAMESPACE === '1') {
    return;
  }

  const resources = await listNamespacedResources();
  if (resources.length === 0) {
    return;
  }

  throw new Error(
    `Namespace ${namespace} already has Kubernetes resources. Run node scripts/run-k8s-local-destroy.mjs first, or rerun with K8S_REUSE_NAMESPACE=1 if you intentionally want to reconcile in place.`,
  );
}

export async function applyOverlay() {
  await run('kubectl', ['apply', '-k', overlayDir]);
}

export async function waitForInfra() {
  for (const deployment of infraDeployments) {
    await waitForRollout(deployment);
  }
}

export async function runBootstrapSequence() {
  const reuseNamespace = process.env.K8S_REUSE_NAMESPACE === '1';
  const forceBootstrapReplay = process.env.K8S_FORCE_BOOTSTRAP_REPLAY === '1';

  if (reuseNamespace && !forceBootstrapReplay) {
    console.log(
      '[k8s-bootstrap] Reusing an existing namespace, so bootstrap jobs are not replayed. Set K8S_FORCE_BOOTSTRAP_REPLAY=1 if you intentionally need to rerun init jobs.',
    );
    return;
  }

  const renderedBootstrap = await run(
    'kubectl',
    ['kustomize', bootstrapDir],
    { captureOutput: true },
  );

  for (const job of bootstrapJobs) {
    const manifest = extractJobManifest(renderedBootstrap, job.name);
    await run('kubectl', [
      '-n',
      namespace,
      'delete',
      'job',
      job.name,
      '--ignore-not-found',
      '--wait=true',
    ]);
    await run(
      'kubectl',
      ['-n', namespace, 'apply', '-f', '-'],
      { input: manifest },
    );
    await run('kubectl', [
      '-n',
      namespace,
      'wait',
      '--for=condition=complete',
      `job/${job.name}`,
      '--timeout=10m',
    ]);
    await waitForRollout(job.waitForDeployment);
  }
}

export async function waitForRuntime() {
  for (const deployment of runtimeDeployments) {
    await waitForRollout(deployment);
  }
}

export async function waitForRollout(deployment) {
  await run('kubectl', [
    '-n',
    namespace,
    'rollout',
    'status',
    `deployment/${deployment}`,
    '--timeout=10m',
  ]);
}

export function startPortForward(logsDir) {
  const child = spawn(
    'kubectl',
    ['-n', namespace, 'port-forward', 'service/campuscore-nginx', `${localPort}:80`],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    },
  );

  const logPath = path.join(logsDir, 'port-forward.log');
  let output = '';
  let closed = false;
  let closeResolver;
  const closedPromise = new Promise((resolve) => {
    closeResolver = resolve;
  });

  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.on('close', async () => {
    closed = true;
    await writeFile(logPath, output, 'utf8');
    closeResolver();
  });

  return {
    child,
    isClosed: () => closed,
    closedPromise,
  };
}

export async function startDetachedPortForward(logsDir) {
  await mkdir(logsDir, { recursive: true });
  const stdoutPath = path.join(logsDir, 'port-forward.out.log');
  const stderrPath = path.join(logsDir, 'port-forward.err.log');

  if (process.platform === 'win32') {
    const child = spawn(
      'kubectl',
      ['-n', namespace, 'port-forward', 'service/campuscore-nginx', `${localPort}:80`],
      {
        cwd: repoRoot,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      },
    );

    child.unref();

    if (!Number.isFinite(child.pid) || child.pid <= 0) {
      throw new Error('Failed to start detached kubectl port-forward on Windows.');
    }

    return {
      pid: child.pid,
      stdoutPath: null,
      stderrPath: null,
    };
  }

  const stdoutFd = openSync(stdoutPath, 'a');
  const stderrFd = openSync(stderrPath, 'a');

  const child = spawn(
    'kubectl',
    ['-n', namespace, 'port-forward', 'service/campuscore-nginx', `${localPort}:80`],
    {
      cwd: repoRoot,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      shell: false,
    },
  );

  closeSync(stdoutFd);
  closeSync(stderrFd);
  child.unref();

  return {
    pid: child.pid,
    stdoutPath,
    stderrPath,
  };
}

export async function startDetachedEdgeSupervisor(logsDir) {
  await mkdir(logsDir, { recursive: true });
  const stdoutPath = path.join(logsDir, 'edge-supervisor.out.log');
  const stderrPath = path.join(logsDir, 'edge-supervisor.err.log');
  const stdoutFd = openSync(stdoutPath, 'a');
  const stderrFd = openSync(stderrPath, 'a');

  const child = spawn(
    process.execPath,
    [edgeSupervisorScriptPath, '--logs-dir', logsDir],
    {
      cwd: repoRoot,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      shell: false,
    },
  );

  closeSync(stdoutFd);
  closeSync(stderrFd);
  child.unref();

  if (!Number.isFinite(child.pid) || child.pid <= 0) {
    throw new Error('Failed to start detached CampusCore K8s edge supervisor.');
  }

  return {
    pid: child.pid,
    stdoutPath,
    stderrPath,
  };
}

export async function stopPortForward(handle) {
  if (!handle) {
    return;
  }

  const { child, isClosed, closedPromise } = handle;

  if (isClosed()) {
    await closedPromise;
    return;
  }

  if (process.platform === 'win32' && child.pid) {
    await run(
      'taskkill',
      ['/PID', String(child.pid), '/T', '/F'],
      { allowFailure: true, captureOutput: true, timeoutMs: 15000 },
    );
    await Promise.race([closedPromise, delay(5000)]);
  }

  if (isClosed()) {
    await closedPromise;
    return;
  }

  child.kill('SIGTERM');

  try {
    await Promise.race([closedPromise, delay(5000)]);
  } catch {
    // Ignore and fall back to forceful termination below if needed.
  }

  if (!isClosed() && process.platform === 'win32' && child.pid) {
    await run(
      'taskkill',
      ['/PID', String(child.pid), '/T', '/F'],
      { allowFailure: true, captureOutput: true, timeoutMs: 15000 },
    );
    await Promise.race([closedPromise, delay(5000)]);
  }
}

export async function stopDetachedProcess(pid) {
  if (!pid || !(await isProcessRunning(pid))) {
    return;
  }

  if (process.platform === 'win32') {
    await run(
      'taskkill',
      ['/PID', String(pid), '/T', '/F'],
      { allowFailure: true, captureOutput: true, timeoutMs: 15000 },
    );
    await delay(2000);
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }

  await delay(2000);
}

export async function runEdgeSmokeChecks() {
  await waitForHttp(`${baseURL}/health`, async (response) => {
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.status === 'ok' && payload?.service === 'campuscore-api';
  });

  await waitForHttp(`${baseURL}/login`, async (response) => response.ok);
  await waitForHttp(`${baseURL}/api/docs`, async (response) => response.ok);
  await waitForHttp(
    `${baseURL}/api/v1/health/readiness`,
    async (response) => response.status === 403,
  );
  await waitForHttp(
    `${baseURL}/api/v1/internal/auth-context/users/test-user`,
    async (response) => response.status === 403,
  );
  await waitForHttp(
    `${baseURL}/api/v1/internal/people-context/users/test-user`,
    async (response) => response.status === 403,
  );

  return fetchJson(`${baseURL}/health`);
}

export async function probeLocalEdgeContractOnce(requestTimeoutMs = 10000) {
  const healthResponse = await fetch(edgeHealthUrls.health, {
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!healthResponse.ok) {
    throw new Error(
      `Expected GET ${edgeHealthUrls.health} to return 200, received ${healthResponse.status}.`,
    );
  }

  const health = await healthResponse.json();
  if (health?.status !== 'ok' || health?.service !== 'campuscore-api') {
    throw new Error(
      `Unexpected health payload from ${edgeHealthUrls.health}: ${JSON.stringify(health)}`,
    );
  }

  await assertHttpStatus(edgeHealthUrls.login, 200, requestTimeoutMs);
  await assertHttpStatus(edgeHealthUrls.docs, 200, requestTimeoutMs);
  await assertHttpStatus(edgeHealthUrls.readiness, 403, requestTimeoutMs);
  await assertHttpStatus(edgeHealthUrls.authContext, 403, requestTimeoutMs);
  await assertHttpStatus(edgeHealthUrls.peopleContext, 403, requestTimeoutMs);

  return {
    namespace,
    baseURL,
    health,
    urls: {
      health: edgeHealthUrls.health,
      login: edgeHealthUrls.login,
      docs: edgeHealthUrls.docs,
      readiness: edgeHealthUrls.readiness,
      authContext: edgeHealthUrls.authContext,
      peopleContext: edgeHealthUrls.peopleContext,
    },
  };
}

export async function summarizeRuntimeState() {
  if (!(await namespaceExists())) {
    return {
      deployments: [],
      services: [],
      pods: [],
      jobs: [],
    };
  }

  const [deployments, services, pods, jobs] = await Promise.all([
    getResourceNames('deployments'),
    getResourceNames('services'),
    getResourceNames('pods'),
    getResourceNames('jobs'),
  ]);

  return { deployments, services, pods, jobs };
}

export async function writeJsonSummary(logsDir, fileName, payload) {
  await writeFile(
    path.join(logsDir, fileName),
    JSON.stringify(payload, null, 2),
    'utf8',
  );
}

export async function readEdgeState() {
  try {
    const raw = await readFile(edgeStatePath, 'utf8');
    return normalizeEdgeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeEdgeState(payload) {
  await mkdir(path.dirname(edgeStatePath), { recursive: true });
  await writeFile(
    edgeStatePath,
    JSON.stringify(normalizeEdgeState(payload), null, 2),
    'utf8',
  );
}

export async function removeEdgeState() {
  await unlink(edgeStatePath).catch(() => undefined);
}

export async function isProcessRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function cleanupStaleEdgeState() {
  const state = await readEdgeState();

  if (!state) {
    return null;
  }

  if (await isProcessRunning(getEdgeControllerPid(state))) {
    return state;
  }

  await removeEdgeState();
  return null;
}

export async function waitForLocalEdgeHealthy(
  timeoutMs = 120000,
  intervalMs = 2000,
  requestTimeoutMs = 10000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await probeLocalEdgeContractOnce(requestTimeoutMs);
    } catch (error) {
      lastError = error;
      await delay(intervalMs);
    }
  }

  throw lastError ?? new Error('Timed out waiting for the local K8s edge.');
}

export async function collectArtifacts(logsDir) {
  const commands = [
    {
      name: 'pods.txt',
      args: ['-n', namespace, 'get', 'pods', '-o', 'wide'],
    },
    {
      name: 'jobs.txt',
      args: ['-n', namespace, 'get', 'jobs'],
    },
    {
      name: 'services.txt',
      args: ['-n', namespace, 'get', 'services'],
    },
    {
      name: 'deployments.txt',
      args: ['-n', namespace, 'get', 'deployments'],
    },
    {
      name: 'events.txt',
      args: ['-n', namespace, 'get', 'events', '--sort-by=.lastTimestamp'],
    },
  ];

  for (const command of commands) {
    const output = await run('kubectl', command.args, {
      captureOutput: true,
      allowFailure: true,
      timeoutMs: 60000,
    });
    await writeFile(path.join(logsDir, command.name), output ?? '', 'utf8');
  }
}

export async function deleteNamespace() {
  await run(
    'kubectl',
    ['delete', 'namespace', namespace, '--ignore-not-found', '--wait=true'],
    { allowFailure: true, timeoutMs: 300000 },
  );
}

export async function removeLocalArtifacts(names) {
  await Promise.all(
    names.map((name) => rm(resolveLogsDir(name), { recursive: true, force: true })),
  );
}

export function printDeployInstructions() {
  console.log('');
  console.log(`[k8s-deploy] CampusCore is running in namespace "${namespace}".`);
  console.log(
    '[k8s-deploy] In Docker Desktop Kubernetes UI, switch Namespace from "default" to "campuscore" to see the stack.',
  );
  console.log(
    `[k8s-deploy] To open the edge locally: node scripts/run-k8s-local-edge.mjs`,
  );
  console.log(
    `[k8s-deploy] To stop the helper later: node scripts/stop-k8s-local-edge.mjs`,
  );
  console.log(
    `[k8s-deploy] The helper is the official browser path; raw kubectl port-forward is debug fallback only.`,
  );
  console.log(`[k8s-deploy] Then open ${baseURL}/login or ${baseURL}/api/docs`);
  console.log('');
}

export function getEdgeControllerPid(state) {
  return state?.supervisorPid ?? state?.pid ?? null;
}

export function getEdgeKubectlPid(state) {
  return state?.kubectlPid ?? null;
}

export function classifyPortForwardLine(line) {
  const message = line.trim();
  if (!message) {
    return {
      kind: 'empty',
      severity: 'debug',
      actionable: false,
    };
  }

  if (/^Forwarding from /iu.test(message)) {
    return {
      kind: 'listener-ready',
      severity: 'info',
      actionable: false,
    };
  }

  if (/^Handling connection for \d+/iu.test(message)) {
    return {
      kind: 'client-disconnect-noise',
      severity: 'debug',
      actionable: false,
    };
  }

  if (
    /error copying from local connection to remote stream/iu.test(message) &&
    /(wsarecv:\s*an existing connection was forcibly closed by the remote host|use of closed network connection|connection reset by peer|broken pipe)/iu.test(
      message,
    )
  ) {
    return {
      kind: 'client-disconnect-noise',
      severity: 'debug',
      actionable: false,
    };
  }

  if (
    /(unable to listen on any of the requested ports|address already in use|lost connection to pod|error upgrading connection|timed out waiting for|service .* not found|pod .* not found|error forwarding port)/iu.test(
      message,
    )
  ) {
    return {
      kind: 'runtime-error',
      severity: 'error',
      actionable: true,
    };
  }

  return {
    kind: 'runtime-log',
    severity: 'info',
    actionable: false,
  };
}

export async function appendLine(filePath, line) {
  await appendFile(filePath, `${line}\n`, 'utf8');
}

function normalizeEdgeState(state) {
  if (!state || typeof state !== 'object') {
    return state;
  }

  const supervisorPid = state.supervisorPid ?? state.pid ?? null;
  return {
    ...state,
    pid: supervisorPid,
    supervisorPid,
    kubectlPid: state.kubectlPid ?? null,
    restartCount: Number(state.restartCount ?? 0),
    status: state.status ?? 'unknown',
  };
}

async function assertHttpStatus(url, expectedStatus, requestTimeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected GET ${url} to return ${expectedStatus}, received ${response.status}.`,
    );
  }
}

export function run(command, args, options = {}) {
  const {
    cwd = repoRoot,
    captureOutput = false,
    allowFailure = false,
    input,
    timeoutMs,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: captureOutput || input ? ['pipe', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutHandle;

    if (captureOutput || input) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }

    if (timeoutMs) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
    }

    child.on('error', (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    });

    child.on('close', (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (timedOut) {
        reject(
          new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`),
        );
        return;
      }

      if (code === 0 || allowFailure) {
        resolve(captureOutput || input ? `${stdout}${stderr}` : undefined);
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} exited with code ${code}${
            stderr ? `\n${stderr}` : ''
          }`,
        ),
      );
    });
  });
}

async function getResourceNames(kind) {
  const output = await run(
    'kubectl',
    ['-n', namespace, 'get', kind, '-o', 'name'],
    { captureOutput: true, allowFailure: true, timeoutMs: 30000 },
  );
  return normalizeOutputLines(output);
}

async function waitForHttp(
  url,
  predicate,
  timeoutMs = 180000,
  intervalMs = 2000,
  requestTimeoutMs = 10000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (await predicate(response)) {
        return;
      }

      lastError = new Error(`Unexpected response ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function fetchJson(url, timeoutMs = 10000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.json();
}

function extractJobManifest(renderedYaml, jobName) {
  const documents = renderedYaml
    .split(/^---\s*$/gmu)
    .map((document) => document.trim())
    .filter(Boolean);

  const matched = documents.find((document) => {
    return (
      /^kind:\s*Job\s*$/mu.test(document) &&
      new RegExp(
        `^metadata:\\s*[\\s\\S]*?^\\s*name:\\s*${escapeForRegExp(jobName)}\\s*$`,
        'mu',
      ).test(document)
    );
  });

  if (!matched) {
    throw new Error(`Could not find rendered bootstrap manifest for job ${jobName}`);
  }

  return `${matched}\n`;
}

function normalizeOutputLines(output) {
  return (output ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('Error from server'));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

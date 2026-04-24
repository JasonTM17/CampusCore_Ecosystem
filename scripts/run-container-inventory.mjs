import { spawnSync } from 'node:child_process';

const namespace = process.env.CONTAINER_INVENTORY_NAMESPACE ?? 'campuscore';
const dockerPrefix = process.env.CONTAINER_INVENTORY_DOCKER_PREFIX ?? 'campuscore';
const strict = process.env.CONTAINER_INVENTORY_STRICT === '1';
const logSince = process.env.CONTAINER_INVENTORY_LOG_SINCE ?? '30m';
const logTail = process.env.CONTAINER_INVENTORY_LOG_TAIL ?? '300';

const logSignalPattern =
  /\b(error|exception|failed|fatal|panic|unhandled|traceback)\b/iu;

const buckets = {
  healthy: [],
  expectedExited: [],
  needsAttention: [],
  externalResidue: [],
};

async function main() {
  console.log('[container-inventory] Starting read-only runtime inventory.');
  console.log(
    `[container-inventory] Docker prefix=${dockerPrefix}; Kubernetes namespace=${namespace}; logs since=${logSince}.`,
  );

  await inspectDocker();
  await inspectKubernetes();

  printSummary();

  if (strict && buckets.needsAttention.length > 0) {
    throw new Error(
      `[container-inventory] Strict mode found ${buckets.needsAttention.length} item(s) needing attention.`,
    );
  }
}

async function inspectDocker() {
  const dockerList = run('docker', [
    'ps',
    '-a',
    '--format',
    '{{json .}}',
  ]);

  if (!dockerList.ok) {
    console.log('[container-inventory] Docker unavailable; skipping Docker inventory.');
    console.log(indent(summarizeCommandFailure(dockerList)));
    return;
  }

  const rows = parseJsonLines(dockerList.stdout);
  if (rows.length === 0) {
    console.log('[container-inventory] Docker has no containers.');
    return;
  }

  const names = rows.map((row) => row.Names).filter(Boolean);
  const inspect = run('docker', ['inspect', ...names], { maxBuffer: 20 * 1024 * 1024 });
  if (!inspect.ok) {
    console.log('[container-inventory] Docker inspect failed; using docker ps data only.');
    console.log(indent(summarizeCommandFailure(inspect)));
    rows.forEach((row) => classifyDockerContainer(toDockerSummary(row)));
    return;
  }

  const inspected = safeJsonParse(inspect.stdout, []);
  const rowsByName = new Map(rows.map((row) => [row.Names, row]));
  inspected
    .map((container) => toDockerSummary(rowsByName.get(stripSlash(container.Name)), container))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((summary) => classifyDockerContainer(summary));

  printDockerInventory();
}

async function inspectKubernetes() {
  const podsResult = run('kubectl', ['get', 'pods', '-n', namespace, '-o', 'json'], {
    maxBuffer: 20 * 1024 * 1024,
  });

  if (!podsResult.ok) {
    console.log(
      `[container-inventory] Kubernetes namespace ${namespace} unavailable; skipping Kubernetes inventory.`,
    );
    console.log(indent(summarizeCommandFailure(podsResult)));
    return;
  }

  const deploymentsResult = run(
    'kubectl',
    ['get', 'deployments', '-n', namespace, '-o', 'json'],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  const servicesResult = run('kubectl', ['get', 'services', '-n', namespace, '-o', 'json'], {
    maxBuffer: 20 * 1024 * 1024,
  });

  const podsJson = safeJsonParse(podsResult.stdout, { items: [] });
  const deploymentsJson = deploymentsResult.ok
    ? safeJsonParse(deploymentsResult.stdout, { items: [] })
    : { items: [] };
  const servicesJson = servicesResult.ok
    ? safeJsonParse(servicesResult.stdout, { items: [] })
    : { items: [] };

  const pods = podsJson.items.map(toKubernetesPodSummary).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const deployments = deploymentsJson.items.map(toKubernetesDeploymentSummary).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const services = servicesJson.items.map(toKubernetesServiceSummary).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const pod of pods) {
    classifyKubernetesPod(pod);
  }
  for (const deployment of deployments) {
    classifyKubernetesDeployment(deployment);
  }

  printKubernetesInventory(pods, deployments, services);
}

function classifyDockerContainer(container) {
  const isCampusCore =
    container.name.startsWith(`${dockerPrefix}-`) ||
    container.composeProject === dockerPrefix ||
    container.name === dockerPrefix;
  const isInit = /(^|-)(init|migrate|bootstrap)(-|$)/iu.test(container.name);
  const isProbe = /(^|-)probe(-|$)/iu.test(container.name);
  const isRunning = container.state === 'running';
  const isExited = container.state === 'exited';
  const logSignal = isCampusCore && isRunning ? readDockerLogSignal(container.name) : null;
  const withLogSignal = { ...container, logSignal };

  if (!isCampusCore) {
    buckets.externalResidue.push({
      ...withLogSignal,
      reason: 'Not part of the CampusCore compose project; recorded only.',
    });
    return;
  }

  if ((isInit || isProbe) && isExited) {
    buckets.expectedExited.push({
      ...withLogSignal,
      reason: isProbe
        ? 'Transient probe container has exited; not part of the runtime path.'
        : 'One-shot init/bootstrap container has completed.',
    });
    return;
  }

  if (isExited && container.exitCode === 0) {
    buckets.expectedExited.push({
      ...withLogSignal,
      reason: 'Exited with code 0 and is not part of the long-running runtime path.',
    });
    return;
  }

  if (isRunning && container.health === 'healthy' && container.restartCount === 0) {
    buckets.healthy.push(withLogSignal);
    return;
  }

  if (isRunning && container.health === 'none' && container.restartCount === 0) {
    buckets.healthy.push({
      ...withLogSignal,
      reason: 'Running without a Docker healthcheck. This is acceptable for local-only tooling such as MailHog.',
    });
    return;
  }

  if (isRunning && container.health === 'starting') {
    buckets.needsAttention.push({
      ...withLogSignal,
      reason: 'Healthcheck is still starting. Re-run the inventory if the service just booted.',
    });
    return;
  }

  buckets.needsAttention.push({
    ...withLogSignal,
    reason: buildDockerAttentionReason(container, logSignal),
  });
}

function classifyKubernetesPod(pod) {
  if (pod.phase === 'Succeeded') {
    buckets.expectedExited.push({
      source: 'kubernetes',
      name: pod.name,
      image: pod.images.join(', '),
      state: pod.phase,
      health: 'completed',
      restartCount: pod.restarts,
      reason: 'Completed Kubernetes Job pod.',
    });
    return;
  }

  if (pod.ready && pod.phase === 'Running' && pod.restarts === 0) {
    buckets.healthy.push({
      source: 'kubernetes',
      name: pod.name,
      image: pod.images.join(', '),
      state: pod.phase,
      health: 'ready',
      restartCount: pod.restarts,
      logSignal: readKubernetesLogSignal(pod.name),
    });
    return;
  }

  buckets.needsAttention.push({
    source: 'kubernetes',
    name: pod.name,
    image: pod.images.join(', '),
    state: pod.phase,
    health: pod.ready ? 'ready' : 'not-ready',
    restartCount: pod.restarts,
    reason: pod.ready
      ? 'Pod is ready but has restart history.'
      : 'Pod is not ready in the target namespace.',
    logSignal: pod.phase === 'Running' ? readKubernetesLogSignal(pod.name) : null,
  });
}

function classifyKubernetesDeployment(deployment) {
  if (deployment.desired === deployment.available && deployment.desired > 0) {
    buckets.healthy.push({
      source: 'kubernetes',
      name: `deployment/${deployment.name}`,
      image: deployment.images.join(', '),
      state: `${deployment.available}/${deployment.desired} available`,
      health: 'available',
      restartCount: 0,
    });
    return;
  }

  buckets.needsAttention.push({
    source: 'kubernetes',
    name: `deployment/${deployment.name}`,
    image: deployment.images.join(', '),
    state: `${deployment.available}/${deployment.desired} available`,
    health: 'not-available',
    restartCount: 0,
    reason: 'Deployment does not have all desired replicas available.',
  });
}

function printDockerInventory() {
  console.log('\n[container-inventory] Docker CampusCore runtime');
  printItems(
    buckets.healthy.filter((item) => item.source !== 'kubernetes'),
    ({ name, image, state, health, restartCount, ports, reason, logSignal }) =>
      `${name} | ${state} | health=${health} | restarts=${restartCount} | image=${image}${ports ? ` | ports=${ports}` : ''}${formatReason(reason)}${formatLogSignal(logSignal)}`,
  );

  console.log('\n[container-inventory] Docker expected exited / transient jobs');
  printItems(
    buckets.expectedExited.filter((item) => item.source !== 'kubernetes'),
    ({ name, image, state, health, exitCode, reason }) =>
      `${name} | ${state} | health=${health} | exit=${exitCode ?? 'n/a'} | image=${image}${formatReason(reason)}`,
  );

  console.log('\n[container-inventory] Docker external residue');
  printItems(
    buckets.externalResidue,
    ({ name, image, state, status, reason }) =>
      `${name} | ${state} | ${status} | image=${image}${formatReason(reason)}`,
  );
}

function printKubernetesInventory(pods, deployments, services) {
  console.log(`\n[container-inventory] Kubernetes namespace ${namespace}: pods`);
  printItems(pods, (pod) => {
    const podClass =
      pod.phase === 'Succeeded'
        ? 'expected exited'
        : pod.ready && pod.restarts === 0
          ? 'healthy'
          : 'needs attention';
    return `${pod.name} | ${podClass} | phase=${pod.phase} | ready=${pod.ready} | restarts=${pod.restarts} | images=${pod.images.join(', ')}`;
  });

  console.log(`\n[container-inventory] Kubernetes namespace ${namespace}: deployments`);
  printItems(
    deployments,
    (deployment) =>
      `${deployment.name} | ${deployment.available}/${deployment.desired} available | images=${deployment.images.join(', ')}`,
  );

  console.log(`\n[container-inventory] Kubernetes namespace ${namespace}: services`);
  printItems(
    services,
    (service) =>
      `${service.name} | type=${service.type} | clusterIP=${service.clusterIP} | ports=${service.ports}`,
  );
}

function printSummary() {
  console.log('\n[container-inventory] Summary');
  console.log(`  healthy: ${buckets.healthy.length}`);
  console.log(`  expected exited: ${buckets.expectedExited.length}`);
  console.log(`  needs attention: ${buckets.needsAttention.length}`);
  console.log(`  external residue: ${buckets.externalResidue.length}`);

  if (buckets.needsAttention.length > 0) {
    console.log('\n[container-inventory] Items needing attention');
    printItems(
      buckets.needsAttention,
      ({ source = 'docker', name, image, state, health, restartCount, reason, logSignal }) =>
        `${source}:${name} | ${state} | health=${health} | restarts=${restartCount} | image=${image}${formatReason(reason)}${formatLogSignal(logSignal)}`,
    );
  }

  console.log(
    strict
      ? '[container-inventory] Strict mode enabled.'
      : '[container-inventory] Strict mode disabled. Set CONTAINER_INVENTORY_STRICT=1 to fail on needs-attention items.',
  );
  console.log('[container-inventory] Inventory complete.');
}

function toDockerSummary(row = {}, inspect = null) {
  const state = inspect?.State?.Status ?? normalizeDockerState(row.State);
  const labels = inspect?.Config?.Labels ?? {};
  return {
    source: 'docker',
    name: stripSlash(inspect?.Name ?? row.Names ?? 'unknown'),
    image: inspect?.Config?.Image ?? row.Image ?? 'unknown',
    state,
    status: row.Status ?? state,
    health: inspect?.State?.Health?.Status ?? 'none',
    exitCode: typeof inspect?.State?.ExitCode === 'number' ? inspect.State.ExitCode : undefined,
    restartCount: inspect?.RestartCount ?? 0,
    ports: row.Ports ?? '',
    composeProject: labels['com.docker.compose.project'] ?? '',
  };
}

function toKubernetesPodSummary(pod) {
  const containers = pod.status?.containerStatuses ?? [];
  return {
    name: pod.metadata?.name ?? 'unknown',
    phase: pod.status?.phase ?? 'Unknown',
    ready: containers.length > 0 && containers.every((container) => container.ready),
    restarts: containers.reduce((total, container) => total + (container.restartCount ?? 0), 0),
    images: containers.map((container) => container.image).filter(Boolean),
  };
}

function toKubernetesDeploymentSummary(deployment) {
  return {
    name: deployment.metadata?.name ?? 'unknown',
    desired: deployment.spec?.replicas ?? 0,
    available: deployment.status?.availableReplicas ?? 0,
    images:
      deployment.spec?.template?.spec?.containers
        ?.map((container) => container.image)
        .filter(Boolean) ?? [],
  };
}

function toKubernetesServiceSummary(service) {
  return {
    name: service.metadata?.name ?? 'unknown',
    type: service.spec?.type ?? 'unknown',
    clusterIP: service.spec?.clusterIP ?? 'none',
    ports:
      service.spec?.ports
        ?.map((port) => `${port.name ?? port.protocol}:${port.port}->${port.targetPort}`)
        .join(', ') ?? 'none',
  };
}

function readDockerLogSignal(name) {
  const result = run('docker', ['logs', '--since', logSince, '--tail', logTail, name], {
    allowFailure: true,
    maxBuffer: 6 * 1024 * 1024,
  });
  return buildLogSignal(result.stdout, result.stderr);
}

function readKubernetesLogSignal(podName) {
  const result = run(
    'kubectl',
    [
      'logs',
      '-n',
      namespace,
      podName,
      '--all-containers=true',
      `--since=${logSince}`,
      `--tail=${logTail}`,
    ],
    {
      allowFailure: true,
      maxBuffer: 6 * 1024 * 1024,
    },
  );
  return buildLogSignal(result.stdout, result.stderr);
}

function buildLogSignal(stdout, stderr) {
  const lines = `${stdout}\n${stderr}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const matches = lines.filter((line) => logSignalPattern.test(line));
  return {
    scannedLines: lines.length,
    matches: matches.length,
    samples: matches.slice(0, 3).map(redact),
  };
}

function buildDockerAttentionReason(container, logSignal) {
  const reasons = [];
  if (container.state !== 'running') {
    reasons.push(`state is ${container.state}`);
  }
  if (!['healthy', 'none'].includes(container.health)) {
    reasons.push(`health is ${container.health}`);
  }
  if (container.restartCount > 0) {
    reasons.push(`restart count is ${container.restartCount}`);
  }
  if (container.exitCode && container.exitCode !== 0) {
    reasons.push(`exit code is ${container.exitCode}`);
  }
  if (logSignal?.matches > 0) {
    reasons.push(`${logSignal.matches} recent log signal(s) matched error patterns`);
  }
  return reasons.join('; ') || 'Container state is outside the healthy/expected-exited policy.';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
  });

  const ok = result.status === 0 && !result.error;
  if (!ok && !options.allowFailure) {
    return {
      ok: false,
      code: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error,
    };
  }

  return {
    ok,
    code: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

function parseJsonLines(value) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJsonParse(line, null))
    .filter(Boolean);
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeDockerState(value) {
  return String(value ?? 'unknown').toLowerCase();
}

function stripSlash(value) {
  return String(value ?? '').replace(/^\//u, '');
}

function printItems(items, formatter) {
  if (items.length === 0) {
    console.log('  none');
    return;
  }

  for (const item of items) {
    console.log(`  - ${formatter(item)}`);
  }
}

function formatReason(reason) {
  return reason ? ` | note=${reason}` : '';
}

function formatLogSignal(logSignal) {
  if (!logSignal) {
    return '';
  }

  if (logSignal.matches === 0) {
    return ` | logs=${logSignal.scannedLines} lines, no error signals`;
  }

  return ` | logs=${logSignal.scannedLines} lines, ${logSignal.matches} signal(s), samples=${logSignal.samples.join(' || ')}`;
}

function summarizeCommandFailure(result) {
  const message = result.error?.message ?? result.stderr ?? result.stdout ?? 'unknown error';
  return redact(message.trim()).split(/\r?\n/u).slice(0, 6).join('\n');
}

function indent(value) {
  return String(value)
    .split(/\r?\n/u)
    .map((line) => `  ${line}`)
    .join('\n');
}

function redact(value) {
  return String(value)
    .replace(/(--token\s+)(\S+)/giu, '$1[redacted]')
    .replace(/(TUNNEL_TOKEN[=:]\s*)(\S+)/giu, '$1[redacted]')
    .replace(/(SMTP_PASSWORD[=:]\s*)(\S+)/giu, '$1[redacted]')
    .replace(/(PASSWORD[=:]\s*)(\S+)/giu, '$1[redacted]')
    .replace(/(SECRET[=:]\s*)(\S+)/giu, '$1[redacted]')
    .replace(/\beyJ[a-zA-Z0-9._-]{20,}\b/gu, '[redacted-jwt-like-token]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

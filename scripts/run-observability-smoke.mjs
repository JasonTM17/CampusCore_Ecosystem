import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const readinessKey =
  process.env.HEALTH_READINESS_KEY ?? 'local-dev-readiness-key-12345';
const prometheusUrl =
  process.env.OBSERVABILITY_PROMETHEUS_URL ?? 'http://127.0.0.1:9090';
const grafanaUrl =
  process.env.OBSERVABILITY_GRAFANA_URL ?? 'http://127.0.0.1:3002';
const lokiUrl = process.env.OBSERVABILITY_LOKI_URL ?? 'http://127.0.0.1:3100';
const tempoUrl =
  process.env.OBSERVABILITY_TEMPO_URL ?? 'http://127.0.0.1:3200';
const tempoOtlpHttpUrl =
  process.env.OBSERVABILITY_TEMPO_OTLP_HTTP_URL ?? 'http://127.0.0.1:4318';
const grafanaUser = process.env.GRAFANA_USER ?? 'admin';
const grafanaPassword =
  process.env.GRAFANA_PASSWORD ??
  readDotEnvValue('GRAFANA_PASSWORD') ??
  'local-dev-grafana-password-change-me';

const expectedPrometheusJobs = [
  'prometheus',
  'core-api',
  'auth-service',
  'notification-service',
  'finance-service',
  'academic-service',
  'engagement-service',
  'people-service',
  'analytics-service',
];
const expectedDashboardUids = [
  'campuscore-executive-overview',
  'campuscore-academic-registration',
  'campuscore-finance-notifications',
];
const expectedDomainQueries = [
  {
    query: 'sum(campuscore_enrollment_status_total)',
    requirePositive: true,
  },
  {
    query: 'count(campuscore_section_pressure_total)',
    requirePositive: true,
  },
  {
    query: 'sum(campuscore_invoice_status_total)',
    requirePositive: true,
  },
  {
    query: 'sum(campuscore_payment_status_total)',
    requirePositive: true,
  },
  {
    query: 'sum(campuscore_notification_delivery_total)',
    requirePositive: true,
  },
];

async function main() {
  await waitUntilReady('Prometheus', `${prometheusUrl}/-/ready`);
  await waitUntilReady('Grafana', `${grafanaUrl}/api/health`);
  await waitUntilReady('Loki', `${lokiUrl}/ready`);
  await waitUntilReady('Tempo', `${tempoUrl}/ready`);
  await waitForPrometheusTargets();

  const metricsQuery = await requestJson(
    `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(
      'sum(campuscore_service_up)',
    )}`,
    {},
    'Prometheus query API',
  );
  if (!Array.isArray(metricsQuery?.data?.result)) {
    throw new Error(
      '[observability-smoke] Prometheus query API did not return a result array.',
    );
  }
  await assertDomainMetrics();

  const datasources = await requestJson(
    `${grafanaUrl}/api/datasources`,
    {
      headers: {
        Authorization: basicAuthHeader(grafanaUser, grafanaPassword),
      },
    },
    'Grafana datasources',
  );

  const datasourceUids = new Set(datasources.map((entry) => entry.uid));
  for (const uid of ['prometheus', 'loki', 'tempo']) {
    if (!datasourceUids.has(uid)) {
      throw new Error(
        `[observability-smoke] Grafana datasource "${uid}" is not provisioned.`,
      );
    }
  }
  await assertGrafanaDashboards();

  await requestJson(
    `${lokiUrl}/loki/api/v1/labels`,
    {},
    'Loki labels API',
  );

  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  const nowNanos = BigInt(Date.now()) * 1_000_000n;

  await request(
    `${tempoOtlpHttpUrl}/v1/traces`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: 'service.name',
                  value: {
                    stringValue: 'campuscore-observability-smoke',
                  },
                },
              ],
            },
            scopeSpans: [
              {
                scope: {
                  name: 'campuscore-observability-smoke',
                },
                spans: [
                  {
                    traceId,
                    spanId,
                    name: 'observability-smoke',
                    kind: 2,
                    startTimeUnixNano: nowNanos.toString(),
                    endTimeUnixNano: (nowNanos + 50_000_000n).toString(),
                    attributes: [
                      {
                        key: 'smoke',
                        value: {
                          boolValue: true,
                        },
                      },
                      {
                        key: 'readiness.key.present',
                        value: {
                          boolValue: Boolean(readinessKey),
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    },
    'Tempo OTLP HTTP ingest',
    {
      acceptedStatusCodes: [200, 202],
    },
  );

  await waitForTrace(traceId);

  console.log(
    [
      '[observability-smoke] Prometheus targets are healthy.',
      '[observability-smoke] CampusCore domain metrics are present.',
      '[observability-smoke] Grafana datasources are provisioned.',
      '[observability-smoke] Grafana production dashboards are provisioned.',
      '[observability-smoke] Loki is reachable.',
      `[observability-smoke] Tempo accepted and returned trace ${traceId}.`,
    ].join('\n'),
  );
}

async function assertDomainMetrics() {
  const missing = [];
  for (const expectation of expectedDomainQueries) {
    const result = await requestJson(
      `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(expectation.query)}`,
      {},
      `Prometheus domain query ${expectation.query}`,
    );
    const sample = result?.data?.result?.[0]?.value?.[1];
    if (!sample || (expectation.requirePositive && Number(sample) <= 0)) {
      missing.push(expectation.query);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[observability-smoke] Domain metrics are empty. Seed observability data and wait for one scrape: ${missing.join(
        ', ',
      )}.`,
    );
  }
}

async function assertGrafanaDashboards() {
  for (const uid of expectedDashboardUids) {
    await requestJson(
      `${grafanaUrl}/api/dashboards/uid/${uid}`,
      {
        headers: {
          Authorization: basicAuthHeader(grafanaUser, grafanaPassword),
        },
      },
      `Grafana dashboard ${uid}`,
    );
  }
}

async function waitForTrace(traceId, timeoutMs = 15_000, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await request(
        `${tempoUrl}/api/traces/${traceId}`,
        {},
        'Tempo trace lookup',
        {
          acceptedStatusCodes: [200, 404],
        },
      );

      if (response.status === 200) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw (
    lastError ??
    new Error(
      `[observability-smoke] Tempo did not return trace ${traceId} before timeout.`,
    )
  );
}

async function waitUntilReady(
  label,
  url,
  timeoutMs = 60_000,
  intervalMs = 2_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await request(url, {}, label, {
        acceptedStatusCodes: [200],
      });
      return;
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw (
    lastError ??
    new Error(`[observability-smoke] ${label} was not ready before timeout.`)
  );
}

async function waitForPrometheusTargets(timeoutMs = 60_000, intervalMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const targets = await requestJson(
        `${prometheusUrl}/api/v1/targets`,
        {},
        'Prometheus targets',
      );
      const activeTargets = targets?.data?.activeTargets ?? [];
      const unhealthy = [];

      for (const job of expectedPrometheusJobs) {
        const target = activeTargets.find(
          (entry) =>
            entry.labels?.job === job || entry.discoveredLabels?.job === job,
        );

        if (!target) {
          unhealthy.push(`${job}:missing`);
          continue;
        }

        if (target.health !== 'up') {
          unhealthy.push(`${job}:${target.health}`);
        }
      }

      if (unhealthy.length === 0) {
        return;
      }

      lastError = new Error(
        `[observability-smoke] Prometheus targets are not ready yet: ${unhealthy.join(
          ', ',
        )}.`,
      );
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw (
    lastError ??
    new Error(
      '[observability-smoke] Prometheus targets did not become healthy before timeout.',
    )
  );
}

async function requestJson(url, init, label) {
  const response = await request(url, init, label);
  return response.json();
}

async function request(url, init = {}, label = url, options = {}) {
  const { acceptedStatusCodes = [200], timeoutMs = 10_000 } = options;

  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      [
        `[observability-smoke] ${label} is not reachable.`,
        '[observability-smoke] Start the local Compose monitoring/runtime stack and rerun this smoke lane.',
        formatError(error),
      ].join(' '),
    );
  }

  if (!acceptedStatusCodes.includes(response.status)) {
    const body = await safeReadBody(response);
    throw new Error(
      `[observability-smoke] ${label} returned ${response.status}. ${body}`.trim(),
    );
  }

  return response;
}

function basicAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function safeReadBody(response) {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDotEnvValue(key) {
  try {
    const contents = readFileSync('.env', 'utf8');
    const pattern = new RegExp(`^${key}=([^\\r\\n#]*)`, 'm');
    const match = contents.match(pattern);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

await main();

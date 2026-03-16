import { check } from 'k6';
import http from 'k6/http';

// Base configuration
export const options = {
  scenarios: {
    // Smoke test - validates basic functionality
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      tags: { test_type: 'smoke' },
    },
    // Load test - baseline performance
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 0 },
      ],
      tags: { test_type: 'load' },
    },
    // Stress test - find breaking point
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '30s', target: 0 },
      ],
      tags: { test_type: 'stress' },
    },
    // Spike test - sudden burst
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 100 },
        { duration: '10s', target: 10 },
        { duration: '10s', target: 0 },
      ],
      tags: { test_type: 'spike' },
    },
    // Soak test - extended duration
    soak: {
      executor: 'constant-vus',
      vus: 20,
      duration: '5m',
      tags: { test_type: 'soak' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    http_reqs: ['rate>10'],
  },
};

// Test configuration
export const config = {
  baseUrl: __ENV.BASE_URL || 'http://localhost',
  apiBaseUrl: __ENV.API_BASE_URL || 'http://localhost/api/v1',
  timeout: parseInt(__ENV.TIMEOUT || '30000'),
};

// Default export with smoke test
export default function () {
  // Health check endpoint
  const healthRes = http.get(`${config.apiBaseUrl}/health`, {
    timeout: config.timeout,
  });

  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
    'health check returns ok': (r) => r.json('status') === 'ok',
  });

  // Sleep between iterations
  sleep(1);
}

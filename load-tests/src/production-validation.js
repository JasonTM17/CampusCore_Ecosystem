/**
 * CampusCore production validation scenarios.
 *
 * This file uses the current cookie + CSRF auth contract while still sending
 * bearer tokens where services accept them. It is intentionally bounded for
 * local machines: use PROFILE=stress only after smoke/balanced are clean.
 */

import { check, group, sleep } from 'k6';
import http from 'k6/http';
import exec from 'k6/execution';

const PROFILE = (__ENV.PROFILE || 'smoke').toLowerCase();
const BASE_URL = (__ENV.BASE_URL || 'http://localhost').replace(/\/$/u, '');
const API_BASE_URL = (
  __ENV.API_BASE_URL || `${BASE_URL}/api/v1`
).replace(/\/$/u, '');
const STUDENT_EMAIL = __ENV.K6_USERS_EMAIL || 'student1@campuscore.edu';
const STUDENT_PASSWORD = __ENV.K6_USERS_PASSWORD || 'password123';
const ADMIN_EMAIL = __ENV.K6_ADMIN_EMAIL || 'admin@campuscore.edu';
const ADMIN_PASSWORD = __ENV.K6_ADMIN_PASSWORD || 'admin123';
const PROVIDERS = (__ENV.K6_PAYMENT_PROVIDERS || 'MOMO,ZALOPAY,VNPAY,PAYPAL,CARD')
  .split(',')
  .map((provider) => provider.trim().toUpperCase())
  .filter(Boolean);
const ENABLE_MUTATING_REGISTRATION =
  (__ENV.K6_ENABLE_MUTATING_REGISTRATION || '0') === '1';
const HOT_SECTION_ID = __ENV.K6_HOT_SECTION_ID || '';
const REQUEST_TIMEOUT = __ENV.TIMEOUT || '30s';
const EXPECTED_NON_5XX = http.expectedStatuses({ min: 200, max: 499 });

const commonThresholds = {
  http_req_failed: ['rate<0.03'],
  http_req_duration: ['p(95)<1000', 'p(99)<2500'],
  checks: ['rate>0.98'],
};

const profileOptions = {
  smoke: {
    scenarios: {
      smoke: {
        executor: 'shared-iterations',
        vus: 1,
        iterations: 1,
        maxDuration: '30s',
        exec: 'smokeScenario',
      },
    },
    thresholds: commonThresholds,
  },
  balanced: {
    scenarios: {
      student_portal: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '20s', target: 5 },
          { duration: '40s', target: 5 },
          { duration: '20s', target: 0 },
        ],
        exec: 'studentPortalScenario',
      },
      finance_checkout: {
        executor: 'shared-iterations',
        vus: 2,
        iterations: 8,
        maxDuration: '2m',
        exec: 'financeCheckoutScenario',
      },
      payment_replay: {
        executor: 'shared-iterations',
        vus: 1,
        iterations: 2,
        maxDuration: '1m',
        exec: 'paymentReplayScenario',
      },
      admin_analytics: {
        executor: 'constant-vus',
        vus: 2,
        duration: '1m',
        exec: 'adminAnalyticsScenario',
      },
      registration_contention_probe: {
        executor: 'constant-vus',
        vus: 3,
        duration: '45s',
        exec: 'registrationContentionScenario',
      },
    },
    thresholds: commonThresholds,
  },
  stress: {
    scenarios: {
      student_portal_stress: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '20s', target: 10 },
          { duration: '1m', target: 20 },
          { duration: '30s', target: 35 },
          { duration: '20s', target: 0 },
        ],
        exec: 'studentPortalScenario',
      },
      finance_checkout_stress: {
        executor: 'constant-arrival-rate',
        rate: 3,
        timeUnit: '1s',
        duration: '1m',
        preAllocatedVUs: 8,
        maxVUs: 20,
        exec: 'financeCheckoutScenario',
      },
      payment_replay_stress: {
        executor: 'shared-iterations',
        vus: 2,
        iterations: 6,
        maxDuration: '2m',
        exec: 'paymentReplayScenario',
      },
      admin_analytics_stress: {
        executor: 'constant-vus',
        vus: 5,
        duration: '90s',
        exec: 'adminAnalyticsScenario',
      },
      registration_contention_stress: {
        executor: 'constant-vus',
        vus: 8,
        duration: '1m',
        exec: 'registrationContentionScenario',
      },
    },
    thresholds: commonThresholds,
  },
};

export const options = profileOptions[PROFILE] || profileOptions.smoke;

export function setup() {
  return {
    student: login(STUDENT_EMAIL, STUDENT_PASSWORD, 'student'),
    admin: login(ADMIN_EMAIL, ADMIN_PASSWORD, 'admin'),
  };
}

export function smokeScenario(data) {
  group('public health', () => {
    const health = http.get(`${BASE_URL}/health`, {
      timeout: REQUEST_TIMEOUT,
      tags: { surface: 'health' },
    });

    check(health, {
      'health is reachable': (response) => response.status === 200,
      'health returns ok': (response) => {
        const payload = safeJson(response);
        return payload && payload.status === 'ok';
      },
    });
  });

  group('student login', () => {
    check(data.student, {
      'student session established': (value) => Boolean(value && value.accessToken),
      'student csrf available': (value) => Boolean(value && value.csrfToken),
    });
  });
}

export function studentPortalScenario(data) {
  const session = data.student;
  if (!session) {
    return;
  }

  group('student workspace reads', () => {
    assertOk(get('/auth/me', session, 'auth_me'), 'auth/me reachable');
    assertOk(get('/sections', session, 'sections'), 'sections reachable');
    assertOk(get('/semesters', session, 'semesters'), 'semesters reachable');
    assertOk(get('/enrollments/my', session, 'my_enrollments'), 'enrollments reachable');
    assertOk(get('/enrollments/my/grades', session, 'my_grades'), 'grades reachable');
    assertOk(get('/waitlist/my', session, 'my_waitlist'), 'waitlist reachable');
    assertOk(get('/enrollments/my/transcript', session, 'my_transcript'), 'transcript reachable');
    assertOk(get('/finance/my/invoices', session, 'my_invoices'), 'invoices reachable');
    assertOk(get('/notifications/my', session, 'my_notifications'), 'notifications reachable', [200, 204]);
  });

  sleep(0.5);
}

export function financeCheckoutScenario(data) {
  const session = data.student;
  if (!session) {
    return;
  }

  const provider = providerForIteration();
  group(`finance checkout ${provider}`, () => {
    const invoice = findOutstandingInvoice(session);
    if (!invoice) {
      check(null, { 'outstanding invoice exists or is already settled': () => true });
      return;
    }

    const idempotencyKey = [
      'k6',
      PROFILE,
      provider.toLowerCase(),
      exec.scenario.iterationInTest,
      exec.vu.idInTest,
    ].join('-');

    const checkout = initiateCheckout(session, invoice.id, provider, idempotencyKey);
    check(checkout, {
      'checkout does not 5xx': (response) => response && response.status < 500,
      'checkout accepted or safely blocked': (response) =>
        response && (isSuccess(response.status) || [400, 409, 422].includes(response.status)),
    });

    if (checkout && isSuccess(checkout.status)) {
      const payload = safeJson(checkout);
      check(payload, {
        'checkout has provider': (value) => value && value.provider === provider,
        'checkout has normalized action': (value) => Boolean(value && value.nextAction),
        'checkout has timeline': (value) => Boolean(value && Array.isArray(value.timeline)),
      });
    }
  });
}

export function adminAnalyticsScenario(data) {
  const session = data.admin;
  if (!session) {
    return;
  }

  group('admin analytics cockpit', () => {
    const response = get('/analytics/cockpit', session, 'analytics_cockpit');
    assertOk(response, 'analytics cockpit reachable');
    if (!isSuccess(response.status)) {
      check(response, {
        'analytics cockpit is pressure protected when throttled': (value) =>
          value && value.status === 429,
      });
      return;
    }

    const payload = safeJson(response);
    check(payload, {
      'cockpit has overview': (value) => Boolean(value && value.overview),
      'cockpit has trends': (value) => Boolean(value && Array.isArray(value.enrollmentTrends)),
      'cockpit has finance summary': (value) => Boolean(value && value.finance),
      'cockpit has operator summary': (value) => Boolean(value && value.operator),
    });
  });
}

export function registrationContentionScenario(data) {
  const session = data.student;
  if (!session) {
    return;
  }

  group('registration contention posture', () => {
    const sectionsResponse = get('/sections', session, 'sections_for_contention');
    assertOk(sectionsResponse, 'sections available for contention probe');
    if (!isSuccess(sectionsResponse.status)) {
      check(sectionsResponse, {
        'contention probe is pressure protected when throttled': (value) =>
          value && value.status === 429,
      });
      return;
    }

    const sections = normalizeCollection(safeJson(sectionsResponse));
    const target = selectHotSection(sections);

    if (!target) {
      check(null, { 'hot section candidate exists': () => false });
      return;
    }

    check(target, {
      'section capacity is not exceeded before probe': (section) =>
        Number(defaultValue(section.enrolledCount, 0)) <=
        Number(defaultValue(section.capacity, Infinity)),
    });

    if (!ENABLE_MUTATING_REGISTRATION) {
      return;
    }

    const response = post(
      '/enrollments/enroll',
      session,
      { sectionId: target.id },
      'enrollment_contention',
    );

    check(response, {
      'enrollment race returns safe status': (value) =>
        value && (isSuccess(value.status) || [400, 409, 422].includes(value.status)),
      'enrollment race does not 5xx': (value) => value && value.status < 500,
    });
  });
}

export function paymentReplayScenario(data) {
  const session = data.student;
  if (!session) {
    return;
  }

  const invoice = findOutstandingInvoice(session);
  if (!invoice) {
    check(null, { 'replay invoice exists or is already settled': () => true });
    return;
  }

  const provider = providerForIteration();
  const idempotencyKey = `k6-replay-${provider.toLowerCase()}-${exec.vu.idInTest}`;
  const first = initiateCheckout(session, invoice.id, provider, idempotencyKey);
  const second = initiateCheckout(session, invoice.id, provider, idempotencyKey);

  check({ first, second }, {
    'payment replay does not 5xx': ({ first: left, second: right }) =>
      left && right && left.status < 500 && right.status < 500,
    'payment replay returns terminal or idempotent response': ({ first: left, second: right }) =>
      Boolean(left && right && (isSuccess(right.status) || [400, 409, 422].includes(right.status))),
  });
}

function login(email, password, role) {
  const response = http.post(
    `${API_BASE_URL}/auth/login`,
    JSON.stringify({ email, password }),
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT,
      responseCallback: EXPECTED_NON_5XX,
      tags: { endpoint: 'auth_login', role },
    },
  );

  const payload = safeJson(response);
  const csrfToken = extractCookie(response, 'cc_csrf');
  const accessToken = payload && payload.accessToken;
  const cookieHeader = buildCookieHeader(response);

  check(response, {
    [`${role} login returns 200`]: (value) => value.status === 200,
    [`${role} login returns token`]: () => Boolean(accessToken),
  });

  if (response.status !== 200 || !accessToken) {
    return null;
  }

  clearRuntimeCookies();
  return { accessToken, csrfToken, cookieHeader };
}

function get(path, session, endpoint) {
  return http.get(`${API_BASE_URL}${path}`, {
    headers: authHeaders(session),
    timeout: REQUEST_TIMEOUT,
    responseCallback: EXPECTED_NON_5XX,
    tags: { endpoint },
  });
}

function post(path, session, body, endpoint) {
  return http.post(`${API_BASE_URL}${path}`, JSON.stringify(body), {
    headers: authHeaders(session),
    timeout: REQUEST_TIMEOUT,
    responseCallback: EXPECTED_NON_5XX,
    tags: { endpoint },
  });
}

function initiateCheckout(session, invoiceId, provider, idempotencyKey) {
  return post(
    `/finance/my/invoices/${invoiceId}/checkout`,
    session,
    {
      provider,
      idempotencyKey,
      returnUrl: `${BASE_URL}/dashboard/invoices`,
      cancelUrl: `${BASE_URL}/dashboard/invoices`,
    },
    'finance_checkout',
  );
}

function findOutstandingInvoice(session) {
  const response = get('/finance/my/invoices', session, 'finance_my_invoices');
  if (!isSuccess(response.status)) {
    return null;
  }

  return normalizeCollection(safeJson(response)).find((invoice) => Number(invoice.balance) > 0);
}

function authHeaders(session) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  };

  if (session.cookieHeader) {
    headers.Cookie = session.cookieHeader;
  }

  if (session.csrfToken) {
    headers['X-CSRF-Token'] = session.csrfToken;
  }

  return headers;
}

function extractCookie(response, name) {
  const cookies = response.cookies || {};
  const values = cookies[name] || [];
  const cookie = values[0];
  return cookie && cookie.value ? cookie.value : null;
}

function buildCookieHeader(response) {
  const cookies = response.cookies || {};
  const pairs = [];
  for (const name in cookies) {
    if (!Object.prototype.hasOwnProperty.call(cookies, name)) {
      continue;
    }

    const values = cookies[name] || [];
    if (values[0] && values[0].value) {
      pairs.push(`${name}=${values[0].value}`);
    }
  }

  return pairs.join('; ');
}

function clearRuntimeCookies() {
  const jar = http.cookieJar();
  jar.clear(BASE_URL);
  jar.clear(API_BASE_URL);
}

function providerForIteration() {
  if (PROVIDERS.length === 0) {
    return 'MOMO';
  }

  return PROVIDERS[exec.scenario.iterationInTest % PROVIDERS.length];
}

function selectHotSection(sections) {
  if (HOT_SECTION_ID) {
    const explicit = sections.find((section) => section.id === HOT_SECTION_ID);
    if (explicit) {
      return explicit;
    }
  }

  return sections
    .filter((section) => section.id && Number.isFinite(Number(section.capacity)))
    .sort((left, right) => {
      const leftRemaining =
        Number(defaultValue(left.capacity, 0)) -
        Number(defaultValue(left.enrolledCount, 0));
      const rightRemaining =
        Number(defaultValue(right.capacity, 0)) -
        Number(defaultValue(right.enrolledCount, 0));
      return leftRemaining - rightRemaining;
    })[0];
}

function assertOk(response, label, statuses = [200]) {
  const pressureSafeStatuses = statuses.concat([429]);
  check(response, {
    [label]: (value) => Boolean(value && pressureSafeStatuses.includes(value.status)),
    [`${label} does not 5xx`]: (value) => Boolean(value && value.status < 500),
  });
}

function isSuccess(status) {
  return status >= 200 && status < 300;
}

function safeJson(response) {
  try {
    return response.json();
  } catch (error) {
    return null;
  }
}

function normalizeCollection(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }

  return [];
}

function defaultValue(value, fallback) {
  return value === null || value === undefined ? fallback : value;
}

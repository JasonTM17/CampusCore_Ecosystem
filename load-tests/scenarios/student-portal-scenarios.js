/**
 * Student Portal Scenarios
 * 
 * Tests critical student-facing endpoints:
 * - Course registration / sections
 * - Student enrollments
 * - Grades
 * - Schedule
 * - Transcript
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { config } from './common.js';

/**
 * Get Sections Scenario
 * Tests fetching available course sections
 */
export function getSectionsScenario(authToken, semesterId = null) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'sections', method: 'GET' },
  };

  if (semesterId) {
    params.params = { semesterId };
  }

  const res = http.get(`${config.apiBaseUrl}/sections`, params);

  check(res, {
    'get sections returns 200': (r) => r.status === 200,
    'get sections returns array': (r) => Array.isArray(r.json('data')),
  });

  return {
    success: res.status === 200,
    data: res.json(),
    response: res,
  };
}

/**
 * Get My Enrollments Scenario
 * Tests fetching student's enrolled courses
 */
export function getMyEnrollmentsScenario(authToken, semesterId = null) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'enrollments', method: 'GET' },
  };

  let url = `${config.apiBaseUrl}/enrollments/my`;
  if (semesterId) {
    url += `?semesterId=${semesterId}`;
  }

  const res = http.get(url, params);

  check(res, {
    'get my enrollments returns 200': (r) => r.status === 200,
    'get my enrollments returns array': (r) => Array.isArray(r.json()),
  });

  return {
    success: res.status === 200,
    data: res.json(),
    response: res,
  };
}

/**
 * Enroll in Section Scenario
 * Tests course enrollment functionality
 */
export function enrollInSectionScenario(authToken, sectionId) {
  const payload = JSON.stringify({ sectionId });
  
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'enrollments', method: 'POST' },
  };

  const res = http.post(`${config.apiBaseUrl}/enrollments/enroll`, payload, params);

  // Accept both success (200-201) and client errors (400-409 for duplicates/conflicts)
  const isSuccess = res.status >= 200 && res.status < 300;
  const isExpectedError = res.status >= 400 && res.status < 500;

  check(res, {
    'enroll returns success or expected error': () => isSuccess || isExpectedError,
  });

  return {
    success: isSuccess,
    error: isExpectedError,
    data: res.json(),
    response: res,
  };
}

/**
 * Get My Grades Scenario
 * Tests fetching student grades
 */
export function getMyGradesScenario(authToken, semesterId = null) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'grades', method: 'GET' },
  };

  let url = `${config.apiBaseUrl}/enrollments/my/grades`;
  if (semesterId) {
    url += `?semesterId=${semesterId}`;
  }

  const res = http.get(url, params);

  check(res, {
    'get my grades returns 200': (r) => r.status === 200,
    'get my grades returns array': (r) => Array.isArray(r.json()),
  });

  return {
    success: res.status === 200,
    data: res.json(),
    response: res,
  };
}

/**
 * Get My Transcript Scenario
 * Tests fetching student transcript
 */
export function getMyTranscriptScenario(authToken, semesterId = null) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'transcript', method: 'GET' },
  };

  let url = `${config.apiBaseUrl}/enrollments/my/transcript`;
  if (semesterId) {
    url += `?semesterId=${semesterId}`;
  }

  const res = http.get(url, params);

  check(res, {
    'get my transcript returns 200': (r) => r.status === 200,
    'get my transcript returns data': (r) => !!r.json('records') || !!r.json('summary'),
  });

  return {
    success: res.status === 200,
    data: res.json(),
    response: res,
  };
}

/**
 * Get My Schedule Scenario
 * Tests fetching student class schedule
 */
export function getMyScheduleScenario(authToken, semesterId = null) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'schedule', method: 'GET' },
  };

  let url = `${config.apiBaseUrl}/sections/my/schedule`;
  if (semesterId) {
    url += `?semesterId=${semesterId}`;
  }

  const res = http.get(url, params);

  check(res, {
    'get my schedule returns 200': (r) => r.status === 200,
    'get my schedule returns array': (r) => Array.isArray(r.json()),
  });

  return {
    success: res.status === 200,
    data: res.json(),
    response: res,
  };
}

/**
 * Get My Invoices Scenario
 * Tests fetching student invoices
 */
export function getMyInvoicesScenario(authToken, semesterId = null) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'invoices', method: 'GET' },
  };

  let url = `${config.apiBaseUrl}/finance/my/invoices`;
  if (semesterId) {
    url += `?semesterId=${semesterId}`;
  }

  const res = http.get(url, params);

  check(res, {
    'get my invoices returns 200': (r) => r.status === 200,
    'get my invoices returns array': (r) => Array.isArray(r.json()),
  });

  return {
    success: res.status === 200,
    data: res.json(),
    response: res,
  };
}

/**
 * Full Student Portal Flow
 * Tests complete student journey:
 * 1. Get available sections
 * 2. Get current enrollments
 * 3. Get grades
 * 4. Get schedule
 * 5. Get invoices
 */
export function studentPortalFlow(authToken, semesterId = null) {
  const results = {};

  // 1. Get sections
  results.sections = getSectionsScenario(authToken, semesterId);
  sleep(0.5);

  // 2. Get enrollments
  results.enrollments = getMyEnrollmentsScenario(authToken, semesterId);
  sleep(0.5);

  // 3. Get grades
  results.grades = getMyGradesScenario(authToken, semesterId);
  sleep(0.5);

  // 4. Get schedule
  results.schedule = getMyScheduleScenario(authToken, semesterId);
  sleep(0.5);

  // 5. Get invoices
  results.invoices = getMyInvoicesScenario(authToken, semesterId);

  const allSuccess = Object.values(results).every((r) => r.success);

  return {
    success: allSuccess,
    results,
  };
}

export default {
  getSectionsScenario,
  getMyEnrollmentsScenario,
  enrollInSectionScenario,
  getMyGradesScenario,
  getMyTranscriptScenario,
  getMyScheduleScenario,
  getMyInvoicesScenario,
  studentPortalFlow,
};

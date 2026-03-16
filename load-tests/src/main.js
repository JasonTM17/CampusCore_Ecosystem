/**
 * CampusCore Load Tests
 * 
 * Main entry point for all load testing scenarios
 * 
 * Usage:
 *   k6 run load-tests/src/main.js
 *   k6 run load-tests/src/main.js -e SCENARIO=smoke
 *   k6 run load-tests/src/main.js -e SCENARIO=load
 *   k6 run load-tests/src/main.js -e SCENARIO=stress
 *   k6 run load-tests/src/main.js -e SCENARIO=spike
 *   k6 run load-tests/src/main.js -e SCENARIO=soak
 * 
 * Environment Variables:
 *   BASE_URL          - Base application URL (default: http://localhost)
 *   API_BASE_URL     - API base URL (default: http://localhost/api/v1)
 *   K6_USERS_EMAIL   - Test user email
 *   K6_USERS_PASSWORD - Test user password
 *   K6_ADMIN_EMAIL   - Admin user email
 *   K6_ADMIN_PASSWORD - Admin user password
 */

import { check, sleep, group } from 'k6';
import http from 'k6/http';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost/api/v1';
const TEST_USER_EMAIL = __ENV.K6_USERS_EMAIL || 'student1@campuscore.edu';
const TEST_USER_PASSWORD = __ENV.K6_USERS_PASSWORD || 'password123';
const ADMIN_USER_EMAIL = __ENV.K6_ADMIN_EMAIL || 'admin@campuscore.edu';
const ADMIN_USER_PASSWORD = __ENV.K6_ADMIN_PASSWORD || 'admin123';

// Test scenario selection
const SCENARIO = __ENV.SCENARIO || 'smoke';

// Auth token storage
let authToken = null;

// Test configuration
export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      tags: { test_type: 'smoke' },
    },
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 0 },
      ],
      tags: { test_type: 'load' },
    },
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 30 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 0 },
      ],
      tags: { test_type: 'stress' },
    },
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },
        { duration: '20s', target: 50 },
        { duration: '10s', target: 5 },
        { duration: '10s', target: 0 },
      ],
      tags: { test_type: 'spike' },
    },
    soak: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5m',
      tags: { test_type: 'soak' },
    },
  },
  
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    http_reqs: ['rate>5'],
  },
};

// Helper functions

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

function login(email, password) {
  const payload = JSON.stringify({ email, password });
  const res = http.post(`${API_BASE_URL}/auth/login`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { scenario: 'login' },
  });

  const success = check(res, {
    'login returns 200': (r) => r.status === 200,
    'login returns access token': (r) => !!r.json('accessToken'),
  });

  if (success) {
    authToken = res.json('accessToken');
  }

  return { success, token: authToken, response: res };
}

function logout() {
  if (!authToken) return { success: false };

  const res = http.post(`${API_BASE_URL}/auth/logout`, null, {
    headers: { 'Authorization': `Bearer ${authToken}` },
    tags: { scenario: 'logout' },
  });

  authToken = null;
  return { success: res.status === 200, response: res };
}

function getCurrentUser() {
  if (!authToken) return null;

  const res = http.get(`${API_BASE_URL}/auth/me`, {
    headers: getAuthHeaders(),
    tags: { scenario: 'getCurrentUser' },
  });

  return { success: res.status === 200, user: res.json(), response: res };
}

function getSections(semesterId = null) {
  const params = { headers: getAuthHeaders(), tags: { endpoint: 'sections' } };
  if (semesterId) params.params = { semesterId };

  const res = http.get(`${API_BASE_URL}/sections`, params);

  return {
    success: res.status === 200,
    data: res.json(),
    response: res,
  };
}

function getMyEnrollments(semesterId = null) {
  let url = `${API_BASE_URL}/enrollments/my`;
  if (semesterId) url += `?semesterId=${semesterId}`;

  const res = http.get(url, {
    headers: getAuthHeaders(),
    tags: { endpoint: 'enrollments' },
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

function getMyGrades(semesterId = null) {
  let url = `${API_BASE_URL}/enrollments/my/grades`;
  if (semesterId) url += `?semesterId=${semesterId}`;

  const res = http.get(url, {
    headers: getAuthHeaders(),
    tags: { endpoint: 'grades' },
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

function getMySchedule(semesterId = null) {
  let url = `${API_BASE_URL}/sections/my/schedule`;
  if (semesterId) url += `?semesterId=${semesterId}`;

  const res = http.get(url, {
    headers: getAuthHeaders(),
    tags: { endpoint: 'schedule' },
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

function getMyInvoices(semesterId = null) {
  let url = `${API_BASE_URL}/finance/my/invoices`;
  if (semesterId) url += `?semesterId=${semesterId}`;

  const res = http.get(url, {
    headers: getAuthHeaders(),
    tags: { endpoint: 'invoices' },
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

function getAnalytics() {
  const res = http.get(`${API_BASE_URL}/analytics/overview`, {
    headers: getAuthHeaders(),
    tags: { endpoint: 'analytics' },
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

// Default function
export default function () {
  // Test health endpoint (always public)
  group('Health Check', () => {
    const res = http.get(`${API_BASE_URL}/health`);
    check(res, {
      'health returns 200': (r) => r.status === 200,
      'health status is ok': (r) => r.json('status') === 'ok',
    });
  });
  
  // For smoke test, also test auth flow
  if (SCENARIO === 'smoke') {
    group('Authentication', () => {
      // Login
      const loginRes = login(TEST_USER_EMAIL, TEST_USER_PASSWORD);
      
      if (loginRes.success && loginRes.token) {
        sleep(0.5);
        
        // Get current user
        const userRes = getCurrentUser();
        if (userRes && userRes.success) {
          check(userRes.response, {
            'get current user returns 200': (r) => r.status === 200,
          });
        }
        sleep(0.5);
        
        // Logout
        logout();
      }
    });
  }
}

// Smoke test specific
export function smokeTest() {
  // Public health check
  group('Health Check', () => {
    const res = http.get(`${API_BASE_URL}/health`);
    check(res, {
      'health returns 200': (r) => r.status === 200,
    });
  });
}

// Load test - realistic student behavior
export function loadTest() {
  // Login as student
  const loginRes = login(TEST_USER_EMAIL, TEST_USER_PASSWORD);
  
  if (!loginRes.success || !loginRes.token) {
    console.log('Login failed');
    return;
  }
  
  // Student portal operations
  group('Student Portal', () => {
    getSections();
    sleep(0.3);
    
    getMyEnrollments();
    sleep(0.3);
    
    getMyGrades();
    sleep(0.3);
    
    getMySchedule();
    sleep(0.3);
    
    getMyInvoices();
  });
  
  // Logout
  logout();
}

// Stress test - mixed operations
export function stressTest() {
  // Randomly choose between student and admin operations
  const isAdmin = Math.random() > 0.7;
  
  if (isAdmin) {
    // Admin flow
    const loginRes = login(ADMIN_USER_EMAIL, ADMIN_USER_PASSWORD);
    
    if (loginRes.success && loginRes.token) {
      getAnalytics();
      logout();
    }
  } else {
    // Student flow
    loadTest();
  }
}

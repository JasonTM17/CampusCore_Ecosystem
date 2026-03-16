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

// Import helpers
import { config, testAuth } from './helpers/config.js';

// Import scenarios
import { healthCheckScenario, loginScenario, getCurrentUserScenario, logoutScenario, authFlowTest } from './scenarios/auth-scenarios.js';
import { 
  getSectionsScenario, 
  getMyEnrollmentsScenario, 
  getMyGradesScenario,
  getMyTranscriptScenario,
  getMyScheduleScenario,
  getMyInvoicesScenario,
  studentPortalFlow 
} from './scenarios/student-portal-scenarios.js';
import { 
  getAnalyticsOverviewScenario, 
  adminPortalFlow 
} from './scenarios/admin-portal-scenarios.js';

// Test scenario selection
const SCENARIO = __ENV.SCENARIO || 'smoke';

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

// Default function for smoke test
export default function () {
  // Test health endpoint (always public)
  group('Health Check', () => {
    const res = http.get(`${config.apiBaseUrl}/health`);
    check(res, {
      'health returns 200': (r) => r.status === 200,
      'health status is ok': (r) => r.json('status') === 'ok',
    });
  });
  
  // For smoke test, also test auth flow
  if (SCENARIO === 'smoke') {
    group('Authentication', () => {
      // Login
      const loginRes = loginScenario(config.testUser.email, config.testUser.password);
      
      if (loginRes.success && loginRes.token) {
        sleep(0.5);
        
        // Get current user
        getCurrentUserScenario(loginRes.token);
        sleep(0.5);
        
        // Logout
        logoutScenario(loginRes.token);
      }
    });
  }
}

// Smoke test specific export
export function smokeTest() {
  // Public health check
  group('Health Check', () => {
    const res = http.get(`${config.apiBaseUrl}/health`);
    check(res, {
      'health returns 200': (r) => r.status === 200,
    });
  });
}

// Load test - realistic student behavior
export function loadTest() {
  // Login as student
  const loginRes = loginScenario(config.testUser.email, config.testUser.password);
  
  if (!loginRes.success || !loginRes.token) {
    console.log('Login failed');
    return;
  }
  
  const token = loginRes.token;
  
  // Student portal operations
  group('Student Portal', () => {
    getSectionsScenario(token);
    sleep(0.3);
    
    getMyEnrollmentsScenario(token);
    sleep(0.3);
    
    getMyGradesScenario(token);
    sleep(0.3);
    
    getMyScheduleScenario(token);
    sleep(0.3);
    
    getMyInvoicesScenario(token);
  });
  
  // Logout
  logoutScenario(token);
}

// Stress test - mixed operations
export function stressTest() {
  // Randomly choose between student and admin operations
  const isAdmin = Math.random() > 0.7;
  
  if (isAdmin) {
    // Admin flow
    const loginRes = loginScenario(config.adminUser.email, config.adminUser.password);
    
    if (loginRes.success && loginRes.token) {
      adminPortalFlow(loginRes.token);
      logoutScenario(loginRes.token);
    }
  } else {
    // Student flow
    loadTest();
  }
}

// Export scenarios for direct execution
export { 
  healthCheckScenario, 
  loginScenario, 
  getCurrentUserScenario, 
  logoutScenario, 
  authFlowTest,
  studentPortalFlow,
  adminPortalFlow 
};

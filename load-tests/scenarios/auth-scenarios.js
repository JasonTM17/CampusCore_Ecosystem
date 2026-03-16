/**
 * Health and Authentication Test Scenarios
 * 
 * Tests basic health checks and authentication flows
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { config, testAuth, testHealth } from './common.js';

/**
 * Health Check Scenario
 * Tests the health endpoint availability
 */
export function healthCheckScenario() {
  const res = http.get(`${config.apiBaseUrl}/health`);
  
  check(res, {
    'health endpoint returns 200': (r) => r.status === 200,
    'health status is ok': (r) => r.json('status') === 'ok',
  });

  return res;
}

/**
 * Login Scenario
 * Tests authentication and token acquisition
 */
export function loginScenario(email, password) {
  const payload = JSON.stringify({
    email: email,
    password: password,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { scenario: 'login' },
  };

  const res = http.post(`${config.apiBaseUrl}/auth/login`, payload, params);

  check(res, {
    'login returns 200': (r) => r.status === 200,
    'login returns access token': (r) => !!r.json('accessToken'),
    'login returns user data': (r) => !!r.json('user'),
  });

  const token = res.json('accessToken');
  const user = res.json('user');

  return {
    success: res.status === 200,
    token,
    user,
    response: res,
  };
}

/**
 * Get Current User Scenario
 * Tests authenticated user info retrieval
 */
export function getCurrentUserScenario(authToken) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { scenario: 'getCurrentUser' },
  };

  const res = http.get(`${config.apiBaseUrl}/auth/me`, params);

  check(res, {
    'get current user returns 200': (r) => r.status === 200,
    'get current user returns user data': (r) => !!r.json('id'),
  });

  return {
    success: res.status === 200,
    user: res.json(),
    response: res,
  };
}

/**
 * Logout Scenario
 * Tests token invalidation
 */
export function logoutScenario(authToken) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
    },
    tags: { scenario: 'logout' },
  };

  const res = http.post(`${config.apiBaseUrl}/auth/logout`, null, params);

  check(res, {
    'logout returns 200': (r) => r.status === 200,
  });

  return {
    success: res.status === 200,
    response: res,
  };
}

/**
 * Full Auth Flow Test
 * Tests complete login -> get user -> logout flow
 */
export function authFlowTest() {
  // Login
  const loginRes = loginScenario(config.testUser.email, config.testUser.password);
  
  if (!loginRes.success || !loginRes.token) {
    console.log('Login failed, cannot proceed with auth flow test');
    return { success: false, step: 'login' };
  }

  sleep(0.5);

  // Get current user
  const userRes = getCurrentUserScenario(loginRes.token);
  
  if (!userRes.success) {
    console.log('Get current user failed');
    return { success: false, step: 'getUser' };
  }

  sleep(0.5);

  // Logout
  const logoutRes = logoutScenario(loginRes.token);

  return {
    success: loginRes.success && userRes.success && logoutRes.success,
    steps: {
      login: loginRes.success,
      getUser: userRes.success,
      logout: logoutRes.success,
    },
  };
}

export default {
  healthCheckScenario,
  loginScenario,
  getCurrentUserScenario,
  logoutScenario,
  authFlowTest,
};

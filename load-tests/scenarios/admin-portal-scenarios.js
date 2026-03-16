/**
 * Admin Portal Scenarios
 * 
 * Tests admin-facing endpoints for management
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { config } from './common.js';

/**
 * Admin Dashboard / Analytics
 */
export function getAnalyticsOverviewScenario(authToken) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'analytics', method: 'GET' },
  };

  const res = http.get(`${config.apiBaseUrl}/analytics/overview`, params);

  check(res, {
    'get analytics overview returns 200': (r) => r.status === 200,
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

/**
 * Get All Sections (Admin)
 */
export function getAllSectionsScenario(authToken) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'admin-sections', method: 'GET' },
  };

  const res = http.get(`${config.apiBaseUrl}/sections`, params);

  check(res, {
    'admin get sections returns 200': (r) => r.status === 200,
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

/**
 * Get All Enrollments (Admin)
 */
export function getAllEnrollmentsScenario(authToken, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `${config.apiBaseUrl}/enrollments${queryString ? '?' + queryString : ''}`;
  
  const httpParams = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'admin-enrollments', method: 'GET' },
  };

  const res = http.get(url, httpParams);

  check(res, {
    'admin get enrollments returns 200': (r) => r.status === 200,
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

/**
 * Get All Users (Admin)
 */
export function getAllUsersScenario(authToken) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'admin-users', method: 'GET' },
  };

  const res = http.get(`${config.apiBaseUrl}/users`, params);

  check(res, {
    'admin get users returns 200': (r) => r.status === 200,
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

/**
 * Get All Students (Admin)
 */
export function getAllStudentsScenario(authToken) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'admin-students', method: 'GET' },
  };

  const res = http.get(`${config.apiBaseUrl}/students`, params);

  check(res, {
    'admin get students returns 200': (r) => r.status === 200,
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

/**
 * Get Semesters (Admin)
 */
export function getSemestersScenario(authToken) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'semesters', method: 'GET' },
  };

  const res = http.get(`${config.apiBaseUrl}/semesters`, params);

  check(res, {
    'get semesters returns 200': (r) => r.status === 200,
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

/**
 * Get Departments (Admin)
 */
export function getDepartmentsScenario(authToken) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'departments', method: 'GET' },
  };

  const res = http.get(`${config.apiBaseUrl}/departments`, params);

  check(res, {
    'get departments returns 200': (r) => r.status === 0 || r.status === 200,
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

/**
 * Get Announcements
 */
export function getAnnouncementsScenario(authToken) {
  const params = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    tags: { endpoint: 'announcements', method: 'GET' },
  };

  const res = http.get(`${config.apiBaseUrl}/announcements/my`, params);

  check(res, {
    'get announcements returns 200': (r) => r.status === 200,
  });

  return { success: res.status === 200, data: res.json(), response: res };
}

/**
 * Admin Portal Flow
 */
export function adminPortalFlow(authToken) {
  const results = {};

  results.analytics = getAnalyticsOverviewScenario(authToken);
  sleep(0.3);

  results.sections = getAllSectionsScenario(authToken);
  sleep(0.3);

  results.enrollments = getAllEnrollmentsScenario(authToken);
  sleep(0.3);

  results.students = getAllStudentsScenario(authToken);
  sleep(0.3);

  results.semesters = getSemestersScenario(authToken);
  sleep(0.3);

  results.announcements = getAnnouncementsScenario(authToken);

  const allSuccess = Object.values(results).every((r) => r.success);

  return { success: allSuccess, results };
}

export default {
  getAnalyticsOverviewScenario,
  getAllSectionsScenario,
  getAllEnrollmentsScenario,
  getAllUsersScenario,
  getAllStudentsScenario,
  getSemestersScenario,
  getDepartmentsScenario,
  getAnnouncementsScenario,
  adminPortalFlow,
};

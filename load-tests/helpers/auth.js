import http from 'k6/http';
import { check, sleep } from 'k6';
import { config } from './config.js';

/**
 * Authentication helper for load testing
 * Handles login and token management
 */

let authToken = null;
let refreshToken = null;

/**
 * Login with credentials and store tokens
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {object} - Login response with tokens
 */
export function login(email, password) {
  const loginUrl = `${config.apiBaseUrl}/auth/login`;
  
  const payload = JSON.stringify({
    email: email,
    password: password,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(loginUrl, payload, params);

  const success = check(res, {
    'login status is 200': (r) => r.status === 200,
    'login returns access token': (r) => !!r.json('accessToken'),
  });

  if (success) {
    authToken = res.json('accessToken');
    refreshToken = res.json('refreshToken');
  }

  return {
    success,
    status: res.status,
    data: res.json(),
  };
}

/**
 * Get current auth token
 * @returns {string|null} - Auth token or null
 */
export function getAuthToken() {
  return authToken;
}

/**
 * Get auth headers with token
 * @returns {object} - Headers object with Authorization
 */
export function getAuthHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  return headers;
}

/**
 * Check if user is authenticated
 * @returns {boolean} - Authentication status
 */
export function isAuthenticated() {
  return !!authToken;
}

/**
 * Logout (invalidate tokens)
 */
export function logout() {
  if (!authToken) return { success: false };

  const logoutUrl = `${config.apiBaseUrl}/auth/logout`;
  
  const res = http.post(logoutUrl, null, {
    headers: getAuthHeaders(),
  });

  authToken = null;
  refreshToken = null;

  return {
    success: res.status === 200,
    status: res.status,
  };
}

/**
 * Get current user info
 */
export function getCurrentUser() {
  if (!authToken) return null;

  const meUrl = `${config.apiBaseUrl}/auth/me`;
  
  const res = http.get(meUrl, {
    headers: getAuthHeaders(),
  });

  if (res.status === 200) {
    return res.json();
  }

  return null;
}

export default {
  login,
  logout,
  getAuthToken,
  getAuthHeaders,
  isAuthenticated,
  getCurrentUser,
};

/**
 * Common imports and shared configuration
 */

import { check, sleep } from 'k6';
import http from 'k6/http';

// Import configuration
export const config = {
  baseUrl: __ENV.BASE_URL || 'http://localhost',
  apiBaseUrl: __ENV.API_BASE_URL || 'http://localhost/api/v1',
  timeout: parseInt(__ENV.TIMEOUT || '30000'),
  
  // Test credentials
  testUser: {
    email: __ENV.K6_USERS_EMAIL || 'student1@campuscore.edu',
    password: __Env.K6_USERS_PASSWORD || 'password123',
  },
  
  adminUser: {
    email: __ENV.K6_ADMIN_EMAIL || 'admin@campuscore.edu',
    password: __ENV.K6_ADMIN_PASSWORD || 'admin123',
  },
};

// Test authentication helper
export const testAuth = {
  token: null,
  
  login(email, password) {
    const payload = JSON.stringify({ email, password });
    const res = http.post(`${config.apiBaseUrl}/auth/login`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (res.status === 200) {
      this.token = res.json('accessToken');
    }
    
    return res;
  },
  
  logout() {
    if (!this.token) return { status: 0 };
    
    const res = http.post(`${config.apiBaseUrl}/auth/logout`, null, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    
    this.token = null;
    return res;
  },
  
  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  },
};

// Test health helper
export const testHealth = {
  check() {
    return http.get(`${config.apiBaseUrl}/health`);
  },
};

export default { config, testAuth, testHealth };

import http from 'k6/http';
import { check } from 'k6';
import { getAuthHeaders, isAuthenticated } from './auth.js';
import { config } from './config.js';

/**
 * HTTP Request helper with common patterns
 */

/**
 * GET request wrapper
 */
export function get(endpoint, params = {}, tags = {}) {
  const url = `${config.apiBaseUrl}${endpoint}`;
  
  const options = {
    headers: getAuthHeaders(),
    params: params,
    tags: tags,
  };

  const res = http.get(url, options);

  return {
    response: res,
    success: check(res, {
      [`GET ${endpoint} status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
    }),
    status: res.status,
    data: res.json(),
  };
}

/**
 * POST request wrapper
 */
export function post(endpoint, payload = {}, tags = {}) {
  const url = `${config.apiBaseUrl}${endpoint}`;
  
  const options = {
    headers: getAuthHeaders(),
    tags: tags,
  };

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  
  const res = http.post(url, body, options);

  return {
    response: res,
    success: check(res, {
      [`POST ${endpoint} status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
    }),
    status: res.status,
    data: res.json(),
  };
}

/**
 * PUT request wrapper
 */
export function put(endpoint, payload = {}, tags = {}) {
  const url = `${config.apiBaseUrl}${endpoint}`;
  
  const options = {
    headers: getAuthHeaders(),
    tags: tags,
  };

  const res = http.put(url, JSON.stringify(payload), options);

  return {
    response: res,
    success: check(res, {
      [`PUT ${endpoint} status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
    }),
    status: res.status,
    data: res.json(),
  };
}

/**
 * DELETE request wrapper
 */
export function del(endpoint, tags = {}) {
  const url = `${config.apiBaseUrl}${endpoint}`;
  
  const options = {
    headers: getAuthHeaders(),
    tags: tags,
  };

  const res = http.del(url, null, options);

  return {
    response: res,
    success: check(res, {
      [`DELETE ${endpoint} status is 2xx`]: (r) => r.status >= 200 && r.status < 300,
    }),
    status: res.status,
    data: res.json(),
  };
}

export default {
  get,
  post,
  put,
  del,
};

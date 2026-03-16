/**
 * Load Test Configuration
 * 
 * Environment Variables:
 * - BASE_URL: Base URL for the application (default: http://localhost)
 * - API_BASE_URL: API base URL (default: http://localhost/api/v1)
 * - TIMEOUT: Request timeout in ms (default: 30000)
 * - K6_USERS_EMAIL: Test user email for authentication
 * - K6_USERS_PASSWORD: Test user password
 */

export const config = {
  // Base URLs
  baseUrl: __ENV.BASE_URL || 'http://localhost',
  apiBaseUrl: __ENV.API_BASE_URL || 'http://localhost/api/v1',
  
  // Request settings
  timeout: parseInt(__ENV.TIMEOUT || '30000'),
  
  // Test credentials (should be provided via env vars)
  testUser: {
    email: __ENV.K6_USERS_EMAIL || 'student1@campuscore.edu',
    password: __ENV.K6_USERS_PASSWORD || 'password123',
  },
  
  // Admin credentials for admin scenarios
  adminUser: {
    email: __ENV.K6_ADMIN_EMAIL || 'admin@campuscore.edu',
    password: __ENV.K6_ADMIN_PASSWORD || 'admin123',
  },
  
  // Test data settings
  testData: {
    // Number of semesters to test with
    semesterIds: (__ENV.K6_SEMESTER_IDS || '').split(',').filter(Boolean),
  },
};

export default config;

import { ENV_DEFAULTS } from './env.constants';
import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const baseEnv = {
    DATABASE_URL:
      'postgresql://postgres:postgres@localhost:5432/campuscore?schema=academic',
    JWT_SECRET: 'access-secret',
  };

  it('applies defaults for optional values', () => {
    const result = validateEnvironment(baseEnv);

    expect(result.PORT).toBe(ENV_DEFAULTS.PORT);
    expect(result.FRONTEND_URL).toBe(ENV_DEFAULTS.FRONTEND_URL);
    expect(result.SWAGGER_ENABLED).toBe(ENV_DEFAULTS.SWAGGER_ENABLED);
  });

  it('requires a readiness key in production', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NODE_ENV: 'production',
        FRONTEND_URL: 'http://localhost:3000',
      }),
    ).toThrow(/HEALTH_READINESS_KEY/);
  });
});

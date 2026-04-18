import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const baseEnv = {
    NODE_ENV: 'development',
    PORT: '4000',
    DATABASE_URL: 'postgresql://campuscore:password@localhost:5432/campuscore',
    JWT_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
  };

  it('fills the frontend URL default outside production', () => {
    const result = validateEnvironment(baseEnv);

    expect(result.FRONTEND_URL).toBe('http://localhost');
  });

  it('requires FRONTEND_URL in production', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NODE_ENV: 'production',
      }),
    ).toThrow(/FRONTEND_URL/);
  });

  it('maps legacy JAGER env names to canonical JAEGER config', () => {
    const result = validateEnvironment({
      ...baseEnv,
      JAGER_AGENT_HOST: 'jaeger',
      JAGER_AGENT_PORT: '6831',
    });

    expect(result.JAEGER_AGENT_HOST).toBe('jaeger');
    expect(result.JAEGER_AGENT_PORT).toBe(6831);
  });

  it('parses COOKIE_SECURE=false as false', () => {
    const result = validateEnvironment({
      ...baseEnv,
      COOKIE_SECURE: 'false',
    });

    expect(result.COOKIE_SECURE).toBe(false);
  });

  it('parses COOKIE_SECURE=true as true', () => {
    const result = validateEnvironment({
      ...baseEnv,
      COOKIE_SECURE: 'true',
    });

    expect(result.COOKIE_SECURE).toBe(true);
  });

  it('rejects invalid JWT duration formats', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        JWT_REFRESH_EXPIRES_IN: 'seven-days',
      }),
    ).toThrow(/JWT_REFRESH_EXPIRES_IN/);
  });
});

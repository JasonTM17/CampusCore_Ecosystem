import { z } from 'zod';
import { ENV, ENV_DEFAULTS } from './env.constants';

const maybeNumber = z.coerce.number().int().positive();
const booleanLike = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((value, ctx) => {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected a boolean-like value',
    });
    return z.NEVER;
  });

const schema = z.object({
  [ENV.NODE_ENV]: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  [ENV.PORT]: maybeNumber.default(ENV_DEFAULTS.PORT),
  [ENV.DATABASE_URL]: z.string().min(1),
  [ENV.FRONTEND_URL]: z.string().url().optional(),
  [ENV.SWAGGER_ENABLED]: z.coerce.boolean().optional(),
  [ENV.COOKIE_SECURE]: booleanLike.optional(),
  [ENV.HEALTH_READINESS_KEY]: z.string().min(16).optional(),
  [ENV.JWT_SECRET]: z.string().min(1),
  [ENV.RABBITMQ_URL]: z.string().min(1).optional(),
});

export function validateEnvironment(env: Record<string, unknown>) {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const frontendUrl = parsed.data[ENV.FRONTEND_URL];

  if (!frontendUrl && parsed.data[ENV.NODE_ENV] === 'production') {
    throw new Error(
      'Invalid environment configuration: FRONTEND_URL: required in production',
    );
  }

  if (
    parsed.data[ENV.NODE_ENV] === 'production' &&
    !parsed.data[ENV.HEALTH_READINESS_KEY]
  ) {
    throw new Error(
      'Invalid environment configuration: HEALTH_READINESS_KEY: required in production',
    );
  }

  return {
    ...parsed.data,
    [ENV.FRONTEND_URL]: frontendUrl ?? ENV_DEFAULTS.FRONTEND_URL,
    [ENV.SWAGGER_ENABLED]:
      parsed.data[ENV.SWAGGER_ENABLED] ?? ENV_DEFAULTS.SWAGGER_ENABLED,
  };
}

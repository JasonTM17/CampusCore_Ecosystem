import { z } from 'zod';
import { ENV, ENV_DEFAULTS } from './env.constants';

const maybeNumber = z.coerce.number().int().positive();
const durationPattern = /^\d+[smhd]$/;
const durationString = z.string().regex(durationPattern);

const environmentSchema = z.object({
  [ENV.NODE_ENV]: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  [ENV.PORT]: maybeNumber.default(ENV_DEFAULTS.PORT),
  [ENV.DATABASE_URL]: z.string().min(1),
  [ENV.FRONTEND_URL]: z.string().url().optional(),
  [ENV.SWAGGER_ENABLED]: z.coerce.boolean().optional(),
  [ENV.JWT_SECRET]: z.string().min(1),
  [ENV.JWT_REFRESH_SECRET]: z.string().min(1),
  [ENV.JWT_EXPIRES_IN]: durationString.default(ENV_DEFAULTS.JWT_EXPIRES_IN),
  [ENV.JWT_REFRESH_EXPIRES_IN]: durationString.default(
    ENV_DEFAULTS.JWT_REFRESH_EXPIRES_IN,
  ),
  [ENV.REDIS_URL]: z.string().min(1).optional(),
  [ENV.RABBITMQ_URL]: z.string().min(1).optional(),
  [ENV.SMTP_HOST]: z.string().min(1).optional(),
  [ENV.SMTP_PORT]: maybeNumber.optional(),
  [ENV.SMTP_USER]: z.string().min(1).optional(),
  [ENV.SMTP_PASSWORD]: z.string().min(1).optional(),
  [ENV.SMTP_SECURE]: z.coerce.boolean().optional(),
  [ENV.EMAIL_FROM]: z.string().min(1).default(ENV_DEFAULTS.EMAIL_FROM),
  [ENV.EMAIL_FROM_NAME]: z
    .string()
    .min(1)
    .default(ENV_DEFAULTS.EMAIL_FROM_NAME),
  [ENV.PASSWORD_RESET_EXPIRY_MINUTES]: maybeNumber.default(
    ENV_DEFAULTS.PASSWORD_RESET_EXPIRY_MINUTES,
  ),
  [ENV.MINIO_ENDPOINT]: z.string().min(1).optional(),
  [ENV.MINIO_PORT]: maybeNumber.optional(),
  [ENV.MINIO_BUCKET]: z.string().min(1).optional(),
  [ENV.MINIO_ACCESS_KEY]: z.string().min(1).optional(),
  [ENV.MINIO_SECRET_KEY]: z.string().min(1).optional(),
  [ENV.LOG_LEVEL]: z.string().min(1).optional(),
  [ENV.JAEGER_AGENT_HOST]: z.string().min(1).optional(),
  [ENV.JAEGER_AGENT_PORT]: maybeNumber.optional(),
});

const aliasMap: Record<string, string> = {
  JWT_EXPIRATION: ENV.JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRATION: ENV.JWT_REFRESH_EXPIRES_IN,
  MAIL_HOST: ENV.SMTP_HOST,
  MAIL_PORT: ENV.SMTP_PORT,
  MAIL_USER: ENV.SMTP_USER,
  MAIL_PASSWORD: ENV.SMTP_PASSWORD,
  MAIL_SECURE: ENV.SMTP_SECURE,
  MAIL_FROM: ENV.EMAIL_FROM,
  MAIL_FROM_NAME: ENV.EMAIL_FROM_NAME,
  JAGER_AGENT_HOST: ENV.JAEGER_AGENT_HOST,
  JAGER_AGENT_PORT: ENV.JAEGER_AGENT_PORT,
};

function normalizeLegacyKeys(env: Record<string, unknown>) {
  const normalized: Record<string, unknown> = { ...env };

  for (const [legacyKey, canonicalKey] of Object.entries(aliasMap)) {
    if (
      normalized[canonicalKey] === undefined &&
      normalized[legacyKey] !== undefined
    ) {
      normalized[canonicalKey] = normalized[legacyKey];
    }
  }

  return normalized;
}

export function validateEnvironment(env: Record<string, unknown>) {
  const normalized = normalizeLegacyKeys(env);
  const parsed = environmentSchema.safeParse(normalized);

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

  return {
    ...parsed.data,
    [ENV.FRONTEND_URL]: frontendUrl ?? ENV_DEFAULTS.FRONTEND_URL,
    [ENV.SWAGGER_ENABLED]:
      parsed.data[ENV.SWAGGER_ENABLED] ?? ENV_DEFAULTS.SWAGGER_ENABLED,
  };
}

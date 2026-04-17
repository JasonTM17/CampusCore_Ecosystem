import { ENV_DEFAULTS } from './env.constants';

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/u, '');
}

export function getAllowedOrigins(frontendUrl?: string) {
  const fallbackOrigin = frontendUrl || ENV_DEFAULTS.FRONTEND_URL;
  const allowedOrigins = new Set(
    fallbackOrigin
      .split(',')
      .map((origin) => normalizeOrigin(origin))
      .filter(Boolean),
  );

  if (allowedOrigins.size === 0) {
    allowedOrigins.add(normalizeOrigin(ENV_DEFAULTS.FRONTEND_URL));
  }

  return allowedOrigins;
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: Set<string>,
) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.has(normalizeOrigin(origin));
}

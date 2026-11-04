#!/usr/bin/env node
/**
 * Guard `mobile/eas.json` against inherited public deployment hosts.
 *
 * This repository is local-first: the EAS profiles may only carry documented
 * loopback/emulator values, and `production` leaves deployment URLs unset so a
 * real future release supplies them deliberately. Run directly:
 *
 *   node scripts/eas-profile-check.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EAS_PROFILES_FILE = 'mobile/eas.json';
export const PUBLIC_HOST_SUFFIX = 'campusute.io.vn';

/** Production must not pin a deployment URL; a real release supplies these. */
export const PRODUCTION_UNSET_KEYS = Object.freeze([
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_PORTAL_URL',
  'EXPO_PUBLIC_ISSUER_URL',
]);

/** Documented local OIDC issuers (mobile/eas.json `local` + dev fallbacks). */
export const LOCAL_ISSUER_HOSTS = Object.freeze(['id.localhost', '10.0.2.2', '127.0.0.1']);

/** Hosts a `local` profile URL may use (EAS local stack only). */
export const LOCAL_URL_HOSTS = Object.freeze([
  ...LOCAL_ISSUER_HOSTS,
  'localhost',
  'portal.localhost',
  '::1',
]);

const PUBLIC_HOST_PROFILES = new Set(['development', 'preview']);

function violation(code, profile, message, key) {
  return key ? { code, profile, key, message } : { code, profile, message };
}

/** Parse an absolute http(s) URL into its protocol and normalized hostname. */
export function parsedHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return {
      protocol: url.protocol,
      hostname: url.hostname.toLowerCase().replace(/^\[|\]$/g, ''),
    };
  } catch {
    return null;
  }
}

export function isPublicHost(hostname) {
  return hostname === PUBLIC_HOST_SUFFIX || hostname.endsWith(`.${PUBLIC_HOST_SUFFIX}`);
}

/** True when a profile value mentions a public campusute host anywhere. */
export function containsPublicHost(value) {
  if (typeof value !== 'string') return false;
  const parsed = parsedHttpUrl(value);
  if (parsed && isPublicHost(parsed.hostname)) return true;
  return /(?:^|[^a-z0-9-])(?:[a-z0-9-]+\.)*campusute\.io\.vn(?![a-z0-9-])/i.test(value);
}

export function parseEasJson(source, file = EAS_PROFILES_FILE) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
}

function walkStrings(value, pathParts = [], out = []) {
  if (typeof value === 'string') {
    out.push({ path: pathParts.join('.'), value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, [...pathParts, String(index)], out));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walkStrings(child, [...pathParts, key], out);
  }
  return out;
}

export function readEasConfig(root = process.cwd(), fsImpl = fs) {
  const file = path.join(root, EAS_PROFILES_FILE);
  if (!fsImpl.existsSync(file)) throw new Error(`${EAS_PROFILES_FILE} is missing`);
  return parseEasJson(fsImpl.readFileSync(file, 'utf8'), EAS_PROFILES_FILE);
}

export function collectProfileViolations(eas) {
  const build = eas?.build;
  if (!build || typeof build !== 'object' || Array.isArray(build)) {
    return [violation('build-missing', null, 'mobile/eas.json has no build object')];
  }

  const violations = [];
  for (const [profileName, profile] of Object.entries(build)) {
    const env = profile && typeof profile.env === 'object' && !Array.isArray(profile.env)
      ? profile.env
      : {};

    if (profileName === 'production') {
      for (const key of PRODUCTION_UNSET_KEYS) {
        if (Object.prototype.hasOwnProperty.call(env, key)) {
          violations.push(violation(
            'production-literal',
            profileName,
            `${key} must stay unset so a real deployment supplies it`,
            key,
          ));
        }
      }
      continue;
    }

    if (PUBLIC_HOST_PROFILES.has(profileName)) {
      for (const { path: valuePath, value } of walkStrings(profile)) {
        if (containsPublicHost(value)) {
          violations.push(violation(
            'public-host',
            profileName,
            `inherited public campusute host in ${valuePath}`,
            valuePath,
          ));
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(env, 'EXPO_PUBLIC_ISSUER_URL')) {
      const issuer = env.EXPO_PUBLIC_ISSUER_URL;
      const parsed = parsedHttpUrl(issuer);
      if (!parsed) {
        violations.push(violation(
          'issuer-url',
          profileName,
          'EXPO_PUBLIC_ISSUER_URL must be an absolute http URL',
          'EXPO_PUBLIC_ISSUER_URL',
        ));
      } else if (parsed.protocol !== 'http:' || !LOCAL_ISSUER_HOSTS.includes(parsed.hostname)) {
        violations.push(violation(
          'issuer-host',
          profileName,
          `issuer host ${parsed.hostname} is not a documented local issuer`,
          'EXPO_PUBLIC_ISSUER_URL',
        ));
      }
    }

    if (profileName === 'local') {
      for (const [key, value] of Object.entries(env)) {
        if (!key.endsWith('_URL')) continue;
        const parsed = parsedHttpUrl(value);
        if (!parsed) {
          violations.push(violation('local-url', profileName, `${key} must be an absolute http(s) URL`, key));
        } else if (!LOCAL_URL_HOSTS.includes(parsed.hostname)) {
          violations.push(violation(
            'local-host',
            profileName,
            `${key} host ${parsed.hostname} is not a documented local host`,
            key,
          ));
        }
      }
    }
  }
  return violations;
}

export function formatViolations(violations) {
  return violations
    .map(({ code, profile, key, message }) =>
      `- [${code}] ${profile ?? 'build'}${key ? `.${key}` : ''}: ${message}`)
    .join('\n');
}

export function assertEasProfilePolicy(eas, file = EAS_PROFILES_FILE) {
  const violations = collectProfileViolations(eas);
  if (violations.length > 0) {
    throw new Error(`${file} failed the local-first profile policy:\n${formatViolations(violations)}`);
  }
  return eas;
}

const invokedDirectly = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    const eas = readEasConfig(process.cwd());
    assertEasProfilePolicy(eas);
    const profiles = Object.keys(eas.build ?? {}).sort();
    console.log(
      `PASS ${EAS_PROFILES_FILE}: ${profiles.join(', ')} keep local-first hosts; `
      + 'production deployment URLs are unset',
    );
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

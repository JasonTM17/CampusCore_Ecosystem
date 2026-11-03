import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CADDY_IMAGE,
  DEFAULT_CONTAINER_NAME,
  DEFAULT_PLACEHOLDERS,
  EXIT_CODES,
  buildDockerArgs,
  checkDockerAvailable,
  parseArgs,
  runCaddyValidate,
  verifyContainerGone,
} from './caddy-validate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const caddyfilePath = path.join(repoRoot, 'ops', 'caddy', 'Caddyfile');

test('Caddy configuration defaults pin the image and placeholder environment', () => {
  assert.equal(DEFAULT_CADDY_IMAGE, 'caddy:2.10.2-alpine');
  assert.equal(DEFAULT_CONTAINER_NAME, 'campuscore-caddy-validate');
  assert.deepEqual(DEFAULT_PLACEHOLDERS, {
    ACME_EMAIL: 'validate@campuscore.local',
    CAMPUSCORE_DOMAIN: 'campuscore.local',
  });
  assert.ok(existsSync(caddyfilePath), 'ops/caddy/Caddyfile must exist in the repository');
});

test('buildDockerArgs constructs argv array without shell composition', () => {
  const args = buildDockerArgs({
    caddyfilePath: 'D:/CampusUTE_EcoSystem/ops/caddy/Caddyfile',
    image: 'caddy:2.10.2-alpine',
    containerName: 'campuscore-caddy-validate',
    env: {
      ACME_EMAIL: 'ops@campuscore.test',
      CAMPUSCORE_DOMAIN: 'campuscore.test',
    },
  });

  assert.ok(Array.isArray(args), 'arguments must be an array of argv tokens');
  assert.ok(args.every((token) => typeof token === 'string'), 'every token must be a string');

  // Must run with --rm and a deterministic container name
  assert.equal(args[0], 'run');
  assert.ok(args.includes('--rm'), 'must include --rm flag');
  const nameIndex = args.indexOf('--name');
  assert.ok(nameIndex !== -1, 'must specify container name');
  assert.equal(args[nameIndex + 1], 'campuscore-caddy-validate');

  // Must mount Caddyfile read-only
  const vIndex = args.indexOf('-v');
  assert.ok(vIndex !== -1, 'must mount volume with -v');
  assert.equal(args[vIndex + 1], 'D:/CampusUTE_EcoSystem/ops/caddy/Caddyfile:/etc/caddy/Caddyfile:ro');

  // Must supply placeholder environment variables
  assert.ok(args.includes('-e'));
  assert.ok(args.includes('ACME_EMAIL=ops@campuscore.test'));
  assert.ok(args.includes('CAMPUSCORE_DOMAIN=campuscore.test'));

  // Target image and command
  const imageIndex = args.indexOf('caddy:2.10.2-alpine');
  assert.ok(imageIndex !== -1, 'image must be passed');
  assert.deepEqual(args.slice(imageIndex), [
    'caddy:2.10.2-alpine',
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
  ]);
});

test('buildDockerArgs uses defaults when optional values are omitted', () => {
  const args = buildDockerArgs({
    caddyfilePath: '/var/ops/Caddyfile',
  });

  assert.ok(args.includes(DEFAULT_CADDY_IMAGE));
  assert.ok(args.includes(DEFAULT_CONTAINER_NAME));
  assert.ok(args.includes(`ACME_EMAIL=${DEFAULT_PLACEHOLDERS.ACME_EMAIL}`));
  assert.ok(args.includes(`CAMPUSCORE_DOMAIN=${DEFAULT_PLACEHOLDERS.CAMPUSCORE_DOMAIN}`));
});

test('checkDockerAvailable detects running vs unavailable docker', () => {
  const upExecutor = (cmd, argv) => {
    assert.equal(cmd, 'docker');
    assert.deepEqual(argv, ['info']);
    return { ok: true, status: 0, stdout: 'Server Version: 29.9.1\n', stderr: '' };
  };
  const upCheck = checkDockerAvailable(upExecutor);
  assert.equal(upCheck.available, true);

  const downExecutor = (cmd, argv) => {
    assert.equal(cmd, 'docker');
    assert.deepEqual(argv, ['info']);
    return {
      ok: false,
      status: 1,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon at npipe:////./pipe/docker_engine.',
      error: new Error('connect ENOENT'),
    };
  };
  const downCheck = checkDockerAvailable(downExecutor);
  assert.equal(downCheck.available, false);
  assert.match(downCheck.error, /Cannot connect to the Docker daemon|ENOENT/);
});

test('runCaddyValidate yields explicit BLOCKED result when Docker is unreachable', async () => {
  const calls = [];
  const mockExecutor = (cmd, argv) => {
    calls.push({ cmd, argv });
    if (cmd === 'docker' && argv[0] === 'info') {
      return { ok: false, status: 1, stdout: '', stderr: 'docker daemon is not running' };
    }
    throw new Error('docker run should never be attempted if info failed');
  };

  const result = await runCaddyValidate({ caddyfile: caddyfilePath }, mockExecutor);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, EXIT_CODES.BLOCKED);
  assert.notEqual(result.code, EXIT_CODES.FAIL, 'BLOCKED exit code must be distinct from validation failure');
  assert.match(result.reason, /Docker is not reachable|unavailable/i);
  assert.equal(calls.length, 1, 'only docker info should have been called');
  assert.deepEqual(calls[0], { cmd: 'docker', argv: ['info'] });
});

test('runCaddyValidate propagates validation failure without Docker daemon', async () => {
  const calls = [];
  const mockExecutor = (cmd, argv) => {
    calls.push({ cmd, argv });
    if (argv[0] === 'info') {
      return { ok: true, status: 0, stdout: 'docker ok', stderr: '' };
    }
    if (argv[0] === 'rm') {
      return { ok: true, status: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'run') {
      return {
        ok: false,
        status: 1,
        stdout: '',
        stderr: 'Error: adapting config using caddyfile: parsing caddyfile tokens: unrecognized directive: bad_directive',
      };
    }
    if (argv[0] === 'ps') {
      return { ok: true, status: 0, stdout: '', stderr: '' };
    }
    return { ok: true, status: 0, stdout: '', stderr: '' };
  };

  const result = await runCaddyValidate({ caddyfile: caddyfilePath }, mockExecutor);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.code, EXIT_CODES.FAIL);
  assert.match(result.output, /unrecognized directive: bad_directive/);
  assert.equal(result.containerProvenGone, true);

  // Check that rm was executed and container presence was checked
  assert.ok(calls.some((c) => c.argv[0] === 'run'));
  assert.ok(calls.some((c) => c.argv[0] === 'ps'));
});

test('runCaddyValidate handles execution timeout and cleans up container', async () => {
  const calls = [];
  const mockExecutor = (cmd, argv) => {
    calls.push({ cmd, argv });
    if (argv[0] === 'info') return { ok: true, status: 0, stdout: '', stderr: '' };
    if (argv[0] === 'rm') return { ok: true, status: 0, stdout: 'campuscore-caddy-validate\n', stderr: '' };
    if (argv[0] === 'run') {
      return {
        ok: false,
        status: 124,
        timedOut: true,
        error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
        stdout: '',
        stderr: '',
      };
    }
    if (argv[0] === 'ps') {
      return { ok: true, status: 0, stdout: '', stderr: '' };
    }
    return { ok: true, status: 0, stdout: '', stderr: '' };
  };

  const result = await runCaddyValidate({
    caddyfile: caddyfilePath,
    timeoutMs: 1000,
  }, mockExecutor);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'TIMEOUT');
  assert.match(result.output, /timed out/i);
  assert.equal(result.containerProvenGone, true);

  // Must have cleaned up container after timeout
  const rmCalls = calls.filter((c) => c.argv[0] === 'rm');
  assert.ok(rmCalls.length >= 1, 'must execute docker rm to terminate timed out container');
});

test('verifyContainerGone verifies container absence and forces removal if present', () => {
  const calls = [];
  let psCount = 0;
  const mockExecutor = (cmd, argv) => {
    calls.push({ cmd, argv });
    if (argv[0] === 'ps') {
      psCount += 1;
      // First call finds lingering container id, second call finds nothing
      return { ok: true, status: 0, stdout: psCount === 1 ? 'abc123container\n' : '', stderr: '' };
    }
    if (argv[0] === 'rm') {
      return { ok: true, status: 0, stdout: 'campuscore-caddy-validate', stderr: '' };
    }
    return { ok: true, status: 0, stdout: '', stderr: '' };
  };

  const isGone = verifyContainerGone('campuscore-caddy-validate', mockExecutor);
  assert.equal(isGone, true);
  assert.equal(calls[0].argv[0], 'ps');
  assert.equal(calls[1].argv[0], 'rm');
  assert.equal(calls[2].argv[0], 'ps');
});

test('runCaddyValidate succeeds on valid configuration and confirms container gone', async () => {
  const calls = [];
  const mockExecutor = (cmd, argv) => {
    calls.push({ cmd, argv });
    if (argv[0] === 'info') return { ok: true, status: 0, stdout: 'version 29', stderr: '' };
    if (argv[0] === 'rm') return { ok: true, status: 0, stdout: '', stderr: '' };
    if (argv[0] === 'run') {
      return {
        ok: true,
        status: 0,
        stdout: 'Valid configuration\n',
        stderr: '',
      };
    }
    if (argv[0] === 'ps') return { ok: true, status: 0, stdout: '', stderr: '' };
    return { ok: true, status: 0, stdout: '', stderr: '' };
  };

  const result = await runCaddyValidate({ caddyfile: caddyfilePath }, mockExecutor);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'PASS');
  assert.equal(result.code, EXIT_CODES.PASS);
  assert.equal(result.containerProvenGone, true);
  assert.match(result.output, /Valid configuration/);
});

test('runCaddyValidate fails a passing validation whose container cannot be proven removed', async () => {
  const mockExecutor = (cmd, argv) => {
    if (argv[0] === 'run') return { ok: true, status: 0, stdout: 'Valid configuration\n', stderr: '' };
    if (argv[0] === 'ps') return { ok: true, status: 0, stdout: 'abc123\n', stderr: '' };
    return { ok: true, status: 0, stdout: '', stderr: '' };
  };

  const result = await runCaddyValidate({ caddyfile: caddyfilePath }, mockExecutor);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.containerProvenGone, false);
  assert.match(result.output, /could not be proven removed/);
});

test('parseArgs parses CLI flags correctly', () => {
  const parsed = parseArgs([
    '--image', 'caddy:custom',
    '--container-name', 'custom-caddy',
    '--caddyfile', 'ops/caddy/Caddyfile',
    '--timeout', '15000',
    '--domain', 'custom.domain.edu',
    '--email', 'admin@custom.domain.edu',
  ]);

  assert.equal(parsed.image, 'caddy:custom');
  assert.equal(parsed.containerName, 'custom-caddy');
  assert.equal(parsed.caddyfile, 'ops/caddy/Caddyfile');
  assert.equal(parsed.timeoutMs, 15000);
  assert.equal(parsed.env.CAMPUSCORE_DOMAIN, 'custom.domain.edu');
  assert.equal(parsed.env.ACME_EMAIL, 'admin@custom.domain.edu');
});

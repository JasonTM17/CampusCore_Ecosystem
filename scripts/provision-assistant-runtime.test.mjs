// Unit tests for scripts/provision-assistant-runtime.mjs — the fail-closed
// validation and URL parsing. The wire-protocol paths are exercised against a
// real PostgreSQL by the Compose bootstrap (docker-compose.yml) on every CI
// compose run; this file keeps those runs honest about the preconditions.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';

import { parseJdbcUrl, PostgresError, provision, WireClient } from './provision-assistant-runtime.mjs';

test('parseJdbcUrl reads host, port, and database from the Spring URL', () => {
  assert.deepEqual(
    parseJdbcUrl('jdbc:postgresql://db.ref.supabase.co:6543/postgres?pgbouncer=true'),
    { host: 'db.ref.supabase.co', port: 6543, database: 'postgres', params: { pgbouncer: 'true' } });
  assert.deepEqual(
    parseJdbcUrl('jdbc:postgresql://postgres:5432/campuscore_restful_e2e?currentSchema=thesis'),
    { host: 'postgres', port: 5432, database: 'campuscore_restful_e2e', params: { currentSchema: 'thesis' } });
  assert.deepEqual(
    parseJdbcUrl('jdbc:postgresql://127.0.0.1/campuscore'),
    { host: '127.0.0.1', port: 5432, database: 'campuscore', params: {} });
});

test('parseJdbcUrl surfaces sslmode for the transport decision', () => {
  assert.equal(
    parseJdbcUrl('jdbc:postgresql://db.ref.supabase.co:6543/postgres?sslmode=require&pgbouncer=true').params.sslmode,
    'require');
  assert.equal(
    parseJdbcUrl('jdbc:postgresql://db.ref.supabase.co/postgres?sslmode=verify-full').params.sslmode,
    'verify-full');
});

test('parseJdbcUrl rejects non-PostgreSQL and database-less URLs', () => {
  assert.throws(() => parseJdbcUrl('jdbc:mysql://host/db'), /jdbc:postgresql/);
  assert.throws(() => parseJdbcUrl('jdbc:postgresql://host-without-db'), /database/);
});

test('provision fails closed without ASSISTANT_DB_PASSWORD', async () => {
  await assert.rejects(
    provision({ SPRING_DATASOURCE_URL: 'jdbc:postgresql://h/db', SPRING_DATASOURCE_USERNAME: 'u', SPRING_DATASOURCE_PASSWORD: 'p' }),
    /ASSISTANT_DB_PASSWORD is required/);
});

test('provision fails closed on a too-short ASSISTANT_DB_PASSWORD', async () => {
  await assert.rejects(
    provision({ ASSISTANT_DB_PASSWORD: 'only-15-charss', SPRING_DATASOURCE_URL: 'jdbc:postgresql://h/db', SPRING_DATASOURCE_USERNAME: 'u', SPRING_DATASOURCE_PASSWORD: 'p' }),
    /at least 16 characters/);
});

test('provision fails closed without a primary database connection', async () => {
  await assert.rejects(
    provision({ ASSISTANT_DB_PASSWORD: 'long-enough-password-123456' }),
    /SPRING_DATASOURCE_URL is required/);
});

// --- Wire client transport and SCRAM checks (stub socket; no network) --------

function fakeSocket() {
  const socket = new EventEmitter();
  socket.writes = [];
  socket.destroyed = false;
  socket.setTimeout = () => socket;
  socket.write = (chunk) => { socket.writes.push(Buffer.from(chunk)); return true; };
  socket.destroy = () => { socket.destroyed = true; return socket; };
  socket.end = () => socket;
  return socket;
}

function withStubbedConnect(socket, fn) {
  const original = net.createConnection;
  net.createConnection = () => socket;
  return Promise.resolve()
    .then(fn)
    .finally(() => { net.createConnection = original; });
}

function pgMessage(type, body = Buffer.alloc(0)) {
  const head = Buffer.alloc(5);
  head[0] = type.charCodeAt(0);
  head.writeUInt32BE(4 + body.length, 1);
  return Buffer.concat([head, body]);
}

function authRequest(code, extra = Buffer.alloc(0)) {
  const body = Buffer.alloc(4 + extra.length);
  body.writeUInt32BE(code, 0);
  extra.copy(body, 4);
  return pgMessage('R', body);
}

const AUTH_OK = authRequest(0);
const READY = pgMessage('Z', Buffer.from('I'));
const tick = () => new Promise((resolve) => setImmediate(resolve));

const REMOTE_TARGET = { host: 'db.example.com', port: 5432, database: 'postgres', user: 'admin' };

test('a non-loopback target sends SSLRequest before the startup message', async () => {
  const socket = fakeSocket();
  const client = new WireClient({ ...REMOTE_TARGET, sslmode: 'require' });
  await withStubbedConnect(socket, async () => {
    const pending = client.connect('a-16-plus-character-password');
    socket.emit('connect');
    await tick();
    assert.equal(socket.writes.length, 1, 'the first frame is the SSL probe');
    assert.equal(socket.writes[0].readUInt32BE(4), 80877103, 'SSLRequest code precedes startup');
    socket.emit('data', Buffer.from('N'));
    await assert.rejects(pending, /SSL/);
  });
});

test('sslmode=require fails closed when the server refuses SSL', async () => {
  const socket = fakeSocket();
  const client = new WireClient({ ...REMOTE_TARGET, sslmode: 'require' });
  await withStubbedConnect(socket, async () => {
    const pending = client.connect('a-16-plus-character-password');
    socket.emit('connect');
    await tick();
    socket.emit('data', Buffer.from('N'));
    socket.emit('close');
    await assert.rejects(pending, /refused SSL/);
  });
});

test('cleartext password auth is refused on an unencrypted non-loopback connection', async () => {
  const socket = fakeSocket();
  const client = new WireClient({ ...REMOTE_TARGET, sslmode: 'disable' });
  await withStubbedConnect(socket, async () => {
    const pending = client.connect('a-16-plus-character-password');
    socket.emit('connect');
    await tick();
    socket.emit('data', Buffer.concat([authRequest(3), AUTH_OK, READY]));
    await assert.rejects(pending, /cleartext/i);
  });
});

test('cleartext password auth is still honoured on loopback', async () => {
  const socket = fakeSocket();
  const password = 'a-16-plus-character-password';
  const client = new WireClient({ host: '127.0.0.1', port: 5432, database: 'postgres', user: 'admin', sslmode: 'disable' });
  await withStubbedConnect(socket, async () => {
    const pending = client.connect(password);
    socket.emit('connect');
    await tick();
    socket.emit('data', Buffer.concat([authRequest(3), AUTH_OK, READY]));
    await pending;
  });
  const passwordFrames = socket.writes.filter((frame) => frame[0] === 0x70);
  assert.equal(passwordFrames.length, 1, 'the client answers the cleartext challenge exactly once');
  const frame = passwordFrames[0];
  assert.deepEqual(
    frame.subarray(5, 1 + frame.readUInt32BE(1)),
    Buffer.concat([Buffer.from(password), Buffer.from([0])]),
    'the PasswordMessage body is the NUL-terminated password');
  assert.equal(socket.destroyed, false, 'a loopback cleartext handshake keeps the socket open');
});

async function scramExchange(socket, password, signature) {
  const client = new WireClient({ ...REMOTE_TARGET, sslmode: 'disable' });
  await withStubbedConnect(socket, async () => {
    const pending = client.connect(password);
    socket.emit('connect');
    await tick();
    socket.emit('data', authRequest(10, Buffer.from('SCRAM-SHA-256\0\0')));
    await tick();
    const initialFrame = socket.writes.at(-1);
    assert.equal(socket.writes.length, 2, 'the startup message and the SASLInitialResponse precede the continuation');
    assert.equal(initialFrame[0], 0x70, 'SASLInitialResponse uses the PasswordMessage type byte');
    assert.equal(initialFrame.subarray(5, 19).toString('utf8'), 'SCRAM-SHA-256\0',
      'SASLInitialResponse names the SCRAM-SHA-256 mechanism');
    const responseLength = initialFrame.readUInt32BE(19);
    assert.equal(responseLength, initialFrame.length - 23, 'the SASL response length matches its payload');
    const clientFirst = initialFrame.subarray(23, 23 + responseLength).toString('utf8');
    assert.match(clientFirst, /^n,,n=,r=[A-Za-z0-9+/=]+$/,
      'SASLInitialResponse carries a client-first message with a client nonce');
    const clientNonce = /r=([A-Za-z0-9+/=]+)/.exec(clientFirst)[1];
    const salt = crypto.randomBytes(16);
    const iterations = 4096;
    const serverFirst = `r=${clientNonce}ZmFrZS1zZXJ2ZXItbm9uY2U=,s=${salt.toString('base64')},i=${iterations}`;
    socket.emit('data', authRequest(11, Buffer.from(serverFirst)));
    await tick();
    const finalFrame = socket.writes.at(-1);
    assert.equal(socket.writes.length, 3, 'the SASLResponse follows the SASLInitialResponse with no extra frames');
    assert.equal(finalFrame[0], 0x70, 'SASLResponse uses the PasswordMessage type byte');
    const clientFinal = finalFrame.subarray(5).toString('utf8');
    assert.match(clientFinal, /^c=biws,r=[^,]+,p=[A-Za-z0-9+/=]+$/,
      'the client-final message carries a non-empty SCRAM proof');
    const clientFinalWithoutProof = clientFinal.slice(0, clientFinal.indexOf(',p='));
    const authMessage = `n=,r=${clientNonce},${serverFirst},${clientFinalWithoutProof}`;
    const saltedPassword = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    const serverKey = crypto.createHmac('sha256', saltedPassword).update('Server Key').digest();
    const validSignature = crypto.createHmac('sha256', serverKey).update(authMessage).digest();
    const sent = signature === 'valid' ? validSignature : Buffer.alloc(validSignature.length, 7);
    socket.emit('data', Buffer.concat([authRequest(12, Buffer.from(`v=${sent.toString('base64')}`)), AUTH_OK, READY]));
    return pending;
  });
  return client;
}

test('a tampered SCRAM server signature aborts the handshake', async () => {
  const socket = fakeSocket();
  const pending = scramExchange(socket, 'a-16-plus-character-password', 'tampered');
  await assert.rejects(pending, /signature/i);
});

test('a valid SCRAM server signature completes authentication', async () => {
  const socket = fakeSocket();
  const client = await scramExchange(socket, 'a-16-plus-character-password', 'valid');
  assert.equal(socket.destroyed, false, 'a verified signature leaves the socket open for the query phase');
  assert.equal(client.failure, null);
  assert.equal(client.closed, false);
  assert.equal(client.buffer.length, 0, 'the ReadyForQuery frame was consumed');
});

// --- Idle-timeout coverage: a half-open peer must fail, never hang ----------

test('an idle socket during SSL negotiation fails instead of hanging', { timeout: 5000 }, async () => {
  const socket = fakeSocket();
  const client = new WireClient({ ...REMOTE_TARGET, sslmode: 'require' });
  await withStubbedConnect(socket, async () => {
    const pending = client.connect('a-16-plus-character-password');
    socket.emit('connect');
    await tick();
    socket.emit('timeout');
    await assert.rejects(pending, /timed out/i);
    assert.equal(socket.destroyed, true);
  });
});

test('an idle socket waiting for authentication fails instead of hanging', { timeout: 5000 }, async () => {
  const socket = fakeSocket();
  const client = new WireClient({ host: '127.0.0.1', port: 5432, database: 'postgres', user: 'admin', sslmode: 'disable' });
  await withStubbedConnect(socket, async () => {
    const pending = client.connect('a-16-plus-character-password');
    socket.emit('connect');
    await tick();
    socket.emit('timeout');
    await assert.rejects(pending, /timed out/i);
    assert.equal(socket.destroyed, true);
  });
});

test('an idle socket mid-query fails instead of hanging', { timeout: 5000 }, async () => {
  const socket = fakeSocket();
  const client = new WireClient({ host: '127.0.0.1', port: 5432, database: 'postgres', user: 'admin', sslmode: 'disable' });
  await withStubbedConnect(socket, async () => {
    const pending = client.connect('a-16-plus-character-password');
    socket.emit('connect');
    await tick();
    socket.emit('data', Buffer.concat([authRequest(3), AUTH_OK, READY]));
    await pending;
    assert.equal(
      socket.writes.filter((frame) => frame[0] === 0x70).length,
      1,
      'the handshake wrote the cleartext password frame');
    assert.equal(socket.destroyed, false, 'the handshake left the socket open for the query');
    const query = client.query('SELECT 1');
    await tick();
    socket.emit('timeout');
    await assert.rejects(query, /timed out/i);
    assert.equal(socket.destroyed, true);
  });
});

// --- Probe-error policy: only an auth failure may reset the password --------

const PROVISION_ENV = {
  ASSISTANT_DB_PASSWORD: 'rotated-value-123456',
  SPRING_DATASOURCE_URL: 'jdbc:postgresql://db.example.com:5432/postgres',
  SPRING_DATASOURCE_USERNAME: 'admin',
  SPRING_DATASOURCE_PASSWORD: 'admin-password',
};

function recordedConnector(probeError) {
  const issued = [];
  const result = { issued, resetAttempted: false };
  const connect = async (target) => {
    if (target.user === 'campuscore_assistant_runtime') {
      if (probeError) throw probeError;
      return { query: async () => [], close() { } };
    }
    return {
      query: async (sql) => {
        issued.push(sql);
        if (/ALTER ROLE campuscore_assistant_runtime LOGIN PASSWORD/.test(sql)) {
          result.resetAttempted = true;
        }
        if (/FROM pg_roles/.test(sql)) {
          return [['postgres', 't'], ['campuscore_assistant_runtime', 't']];
        }
        return [];
      },
      close() { },
    };
  };
  return { ...result, connect, state: result };
}

test('a connection-limit probe error aborts without resetting the role password', async () => {
  const { connect, issued } = recordedConnector(
    new PostgresError({ C: '53300', M: 'too many connections for role' }));
  await assert.rejects(provision(PROVISION_ENV, () => { }, connect), /53300/);
  assert.equal(issued.some((sql) => /ALTER ROLE/.test(sql)), false);
});

test('a transport-level probe error aborts without resetting the role password', async () => {
  const { connect, issued } = recordedConnector(new Error('TLS handshake failed: certificate expired'));
  await assert.rejects(provision(PROVISION_ENV, () => { }, connect), /TLS handshake failed/);
  assert.equal(issued.some((sql) => /ALTER ROLE/.test(sql)), false);
});

test('an authorization probe rejection fails closed without resetting the role password', async () => {
  const { connect, issued, state } = recordedConnector(
    new PostgresError({ C: '28000', M: 'no pg_hba.conf entry for host' }));
  await assert.rejects(provision(PROVISION_ENV, () => { }, connect), (error) => {
    assert.match(error.message, /SQLSTATE 28000/);
    assert.match(error.message, /pg_hba/i);
    assert.match(error.message, /role login rights/i);
    assert.doesNotMatch(error.message, /rotated-value-123456|admin-password/);
    return true;
  });
  assert.equal(state.resetAttempted, false);
  assert.equal(issued.filter((sql) => /ALTER ROLE campuscore_assistant_runtime LOGIN PASSWORD/.test(sql)).length, 0);
});

test('a rejected probe password resets the role password exactly once', async () => {
  const { connect, issued, state } = recordedConnector(
    new PostgresError({ C: '28P01', M: 'password authentication failed' }));
  await provision(PROVISION_ENV, () => { }, connect);
  assert.equal(state.resetAttempted, true);
  assert.equal(issued.filter((sql) => /ALTER ROLE campuscore_assistant_runtime LOGIN PASSWORD/.test(sql)).length, 1);
});

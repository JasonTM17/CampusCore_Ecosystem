// Unit tests for scripts/provision-assistant-runtime.mjs — the fail-closed
// validation and URL parsing. The wire-protocol paths are exercised against a
// real PostgreSQL by the Compose bootstrap (docker-compose.yml) on every CI
// compose run; this file keeps those runs honest about the preconditions.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';

import { parseJdbcUrl, provision, WireClient } from './provision-assistant-runtime.mjs';

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
  socket.setTimeout = () => socket;
  socket.write = (chunk) => { socket.writes.push(Buffer.from(chunk)); return true; };
  socket.destroy = () => socket;
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
  const client = new WireClient({ host: '127.0.0.1', port: 5432, database: 'postgres', user: 'admin', sslmode: 'disable' });
  await withStubbedConnect(socket, async () => {
    const pending = client.connect('a-16-plus-character-password');
    socket.emit('connect');
    await tick();
    socket.emit('data', Buffer.concat([authRequest(3), AUTH_OK, READY]));
    await pending;
  });
});

async function scramExchange(socket, password, signature) {
  const client = new WireClient({ ...REMOTE_TARGET, sslmode: 'disable' });
  return withStubbedConnect(socket, async () => {
    const pending = client.connect(password);
    socket.emit('connect');
    await tick();
    socket.emit('data', authRequest(10, Buffer.from('SCRAM-SHA-256\0\0')));
    await tick();
    const clientFirst = socket.writes.at(-1).subarray(24).toString('utf8');
    const clientNonce = /r=([A-Za-z0-9+/=]+)/.exec(clientFirst)[1];
    const salt = crypto.randomBytes(16);
    const iterations = 4096;
    const serverFirst = `r=${clientNonce}ZmFrZS1zZXJ2ZXItbm9uY2U=,s=${salt.toString('base64')},i=${iterations}`;
    socket.emit('data', authRequest(11, Buffer.from(serverFirst)));
    await tick();
    const clientFinal = socket.writes.at(-1).subarray(5).toString('utf8');
    const clientFinalWithoutProof = clientFinal.slice(0, clientFinal.indexOf(',p='));
    const authMessage = `n=,r=${clientNonce},${serverFirst},${clientFinalWithoutProof}`;
    const saltedPassword = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    const serverKey = crypto.createHmac('sha256', saltedPassword).update('Server Key').digest();
    const validSignature = crypto.createHmac('sha256', serverKey).update(authMessage).digest();
    const sent = signature === 'valid' ? validSignature : Buffer.alloc(validSignature.length, 7);
    socket.emit('data', Buffer.concat([authRequest(12, Buffer.from(`v=${sent.toString('base64')}`)), AUTH_OK, READY]));
    return pending;
  });
}

test('a tampered SCRAM server signature aborts the handshake', async () => {
  const socket = fakeSocket();
  const pending = scramExchange(socket, 'a-16-plus-character-password', 'tampered');
  await assert.rejects(pending, /signature/i);
});

test('a valid SCRAM server signature completes authentication', async () => {
  const socket = fakeSocket();
  await scramExchange(socket, 'a-16-plus-character-password', 'valid');
});

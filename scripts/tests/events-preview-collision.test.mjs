import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

test('preview collision leaves the existing listener and unowned stack alone', async () => {
  const server = net.createServer(socket => {
    // The preflight probe deliberately destroys its connection after connect.
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'campusute-collision-'));
  try {
    await assert.rejects(promisify(execFile)(process.execPath, [
      'scripts/ecosystem-events-verify.mjs', 'preview', '--project', 'campuscore-collision-test',
      '--web-port', String(port),
      '--evidence', evidence,
    ], { cwd: process.cwd(), timeout: 15000 }), error => error.code === 1 && error.stderr.includes(`port ${port} in use`));
    assert.equal(server.listening, true);
    const report = JSON.parse(fs.readFileSync(path.join(evidence, 'preview.json'), 'utf8'));
    assert.equal(report.teardown, 'not-created');
    assert.equal(report.ok, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(evidence)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(evidence).startsWith('campusute-collision-'));
    fs.rmSync(evidence, { recursive: true, force: true });
  }
});

#!/usr/bin/env node
/**
 * contract-verify.mjs — P03 step 3, `contracts` gate cases.
 *
 * Subcommands:
 *   contract-probes --project <p> --evidence <dir>
 *     Boots the disposable e2e stack (postgres + assistant provisioner + api on
 *     host port 4100), then runs, in order:
 *       1. generate-api-contract --check (byte-equal artifacts, invariants);
 *       2. header probes — every response must carry `Cache-Control: no-store`
 *          and echo/validate X-Request-Id (supplied id echoed, injected id
 *          replaced by a server UUID);
 *       3. log-redaction sentinel — a marked bearer token and password are sent
 *          to the API; container logs must not contain either literal.
 *     Always tears the stack down; writes contract-probes.json + log.
 *
 *   pgit-real --project <p> --evidence <dir>
 *     Forces real PostgreSQL integration tests for the contract-relevant
 *     session/credential/idempotency families by delegating to
 *     platform-verify.mjs pgit (single implementation, evidence written to the
 *     contracts evidence dir).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = path.join(REPO, "docker-compose.e2e.yml");
const API_HOST_PORT = 4100;

function parseArgs(argv) {
  const a = { evidence: path.join(REPO, "artifacts/verification/contracts"), project: null, its: null };
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === "--evidence") a.evidence = path.resolve(argv[++i]);
    else if (argv[i] === "--project") a.project = argv[++i];
    else if (argv[i] === "--its") a.its = argv[++i];
  }
  return a;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: REPO, encoding: "utf8", timeout: opts.timeout ?? 120000,
    env: { ...process.env, ...(opts.env ?? {}) },
    shell: opts.shell ?? false,
  });
  return {
    status: res.status, error: res.error ? String(res.error) : null,
    stdout: res.stdout ?? "", stderr: res.stderr ?? "",
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch { /* keep waiting */ }
    await sleep(2000);
  }
  return false;
}

function composeArgs(project) {
  return [
    "compose", "-p", project, "-f", COMPOSE,
  ];
}

async function caseProbes(args, log) {
  const evidence = {};
  const project = args.project ?? `campuscore-contract-${process.pid}`;
  const pgPort = await freePort();
  const env = {
    COMPOSE_PROJECT_NAME: project,
    POSTGRES_HOST_PORT: String(pgPort),
    E2E_API_HOST_PORT: String(API_HOST_PORT),
  };
  evidence.project = project;
  evidence.postgresPort = pgPort;
  evidence.apiPort = API_HOST_PORT;

  const results = { generator: null, headers: [], requestId: [], logRedaction: null };
  let failed = false;
  const teardown = () => {
    run("docker", ["compose", "-p", project, "-f", COMPOSE, "down", "-v", "--remove-orphans"], { timeout: 120000 });
  };

  try {
    const portCheck = await fetch(`http://127.0.0.1:${API_HOST_PORT}/api/v1/health/liveness`, {
      signal: AbortSignal.timeout(3000),
    }).then(() => "occupied").catch(() => "free");
    if (portCheck === "occupied") {
      throw new Error(`port ${API_HOST_PORT} already serves an API — stop it before contract probes`);
    }

    log(`up ${project} pg:${pgPort} api:${API_HOST_PORT}`);
    const up = run("docker", [...composeArgs(project), "up", "-d", "--build"], { env, timeout: 900000 });
    if (up.status !== 0) throw new Error(`compose up failed: ${up.stderr.slice(-800)}`);

    const healthy = await waitHealth(`http://127.0.0.1:${API_HOST_PORT}/api/v1/health/liveness`, 240000);
    if (!healthy) throw new Error("api did not reach liveness within 240s");
    evidence.apiReady = true;

    // 1. Byte-equal contract regeneration + invariants (exact acceptance cmd).
    const gen = run("node", [
      "scripts/generate-api-contract.mjs", "--base-url", `http://127.0.0.1:${API_HOST_PORT}`, "--check",
    ], { timeout: 300000 });
    results.generator = { status: gen.status };
    log(`generator --check exit=${gen.status}\n${gen.stdout.slice(-1500)}`);
    if (gen.status !== 0) failed = true;

    // 2. Response header contract. Private-class responses (the 401 on a
    // protected path) MUST be no-store; public endpoints are recorded only —
    // P06 intentionally adds public caching later, so asserting no-store there
    // would collide with a sanctioned behavior (Kongming P03-F7).
    const probes = [
      { id: "protected-401", url: `/api/v1/notifications`, expectStatus: 401, requireNoStore: true },
      { id: "public-feed", url: `/api/v1/announcements/public`, expectStatus: null, requireNoStore: false },
      { id: "apidocs", url: `/v3/api-docs`, expectStatus: null, requireNoStore: false },
    ];
    for (const p of probes) {
      const res = await fetch(`http://127.0.0.1:${API_HOST_PORT}${p.url}`, { redirect: "manual" });
      const cc = res.headers.get("cache-control") ?? "";
      const rid = res.headers.get("x-request-id");
      const entry = {
        id: p.id, status: res.status, cacheControl: cc, requestId: rid,
        noStore: cc.includes("no-store"), hasRequestId: Boolean(rid),
        statusOk: p.expectStatus === null || res.status === p.expectStatus,
        requireNoStore: p.requireNoStore,
      };
      results.headers.push(entry);
      if (!entry.statusOk || !entry.hasRequestId || (p.requireNoStore && !entry.noStore)) failed = true;
      log(`header ${p.id}: status=${res.status} cc="${cc}" rid=${rid}`);
    }

    // Supplied valid id must echo; invalid/malicious id must be replaced.
    const supplied = `contract-probe-${Date.now().toString(36)}`;
    const echoRes = await fetch(`http://127.0.0.1:${API_HOST_PORT}/api/v1/health/liveness`, {
      headers: { "X-Request-Id": supplied },
    });
    const echoed = echoRes.headers.get("x-request-id");
    results.requestId.push({ probe: "supplied", sent: supplied, received: echoed, pass: echoed === supplied });
    // `;` is sendable over HTTP but outside the filter charset, so the server
    // must replace it with its own id rather than trusting the caller value.
    const evil = "forged;id<script>";
    const evilRes = await fetch(`http://127.0.0.1:${API_HOST_PORT}/api/v1/health/liveness`, {
      headers: { "X-Request-Id": evil },
    });
    const evilEcho = evilRes.headers.get("x-request-id");
    const evilPass = evilEcho !== null && evilEcho !== evil && /^[A-Za-z0-9._:-]{1,128}$/.test(evilEcho);
    results.requestId.push({ probe: "invalid", sent: evil, received: evilEcho, pass: evilPass });
    if (!results.requestId.every((r) => r.pass)) failed = true;
    log(`request-id supplied=${echoed === supplied} invalid-replaced=${evilPass}`);

    // 3. Log-redaction sentinel: credentials must never appear in logs.
    const bearerSentinel = `SENTINEL-BEARER-${Date.now().toString(36)}x`;
    const passSentinel = `SENTINEL-PASS-${Date.now().toString(36)}x`;
    await fetch(`http://127.0.0.1:${API_HOST_PORT}/api/v1/notifications`, {
      headers: { Authorization: `Bearer ${bearerSentinel}` },
    }).catch(() => {});
    await fetch(`http://127.0.0.1:${API_HOST_PORT}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sentinel@example.invalid", password: passSentinel }),
    }).catch(() => {});
    await sleep(1500);
    const logs = run("docker", ["compose", "-p", project, "-f", COMPOSE, "logs", "--no-color", "--tail", "4000", "restful-api"], { timeout: 120000 });
    const hay = logs.stdout + logs.stderr;
    results.logRedaction = {
      bearerLeaked: hay.includes(bearerSentinel),
      passwordLeaked: hay.includes(passSentinel),
      scannedBytes: hay.length,
      logsExit: logs.status,
    };
    // An empty/failed log capture must FAIL, never read as "no leak" (F5).
    if (logs.status !== 0 || hay.length === 0) failed = true;
    if (results.logRedaction.bearerLeaked || results.logRedaction.passwordLeaked) failed = true;
    log(`log-redaction bearer=${results.logRedaction.bearerLeaked} password=${results.logRedaction.passwordLeaked}`);

    evidence.results = results;
    evidence.verdict = failed ? "FAIL" : "PASS";
  } catch (e) {
    failed = true;
    evidence.error = String(e?.message ?? e);
    evidence.verdict = "FAIL";
    log(`ERROR ${evidence.error}`);
  } finally {
    teardown();
  }
  return { evidence, failed };
}

function casePgitReal(args, log) {
  const its = args.its
    ?? "AuthCredentialRevocationPostgresIT,AuthSessionLockOrderingPostgresIT,CredentialSessionLockOrderPostgresIT,AcademicEnrollmentIdempotencyRacePostgresIT";
  const res = run("node", [
    "scripts/platform-verify.mjs", "pgit",
    "--project", args.project ?? `campuscore-contract-pg-${process.pid}`,
    "--evidence", args.evidence,
    "--its", its,
    "--result", "pgit-real-detail.json",
    "--log-name", "pgit-real-mvn.log",
  ], { timeout: 1800000 });
  log(res.stdout.slice(-2000) + res.stderr.slice(-1000));
  return { evidence: { delegated: "platform-verify.mjs pgit", result: "pgit-real-detail.json", exit: res.status }, failed: res.status !== 0 };
}

async function main() {
  const sub = process.argv[2];
  const args = parseArgs(process.argv);
  mkdirSync(args.evidence, { recursive: true });
  const logLines = [];
  const log = (s) => { logLines.push(s); };

  let outcome;
  if (sub === "contract-probes") outcome = await caseProbes(args, log);
  else if (sub === "pgit-real") outcome = casePgitReal(args, log);
  else {
    console.error("usage: contract-verify.mjs <contract-probes|pgit-real> [--project p] [--evidence dir] [--its pattern]");
    process.exit(2);
  }

  const base = sub === "contract-probes" ? "contract-probes" : "pgit-real";
  // "-detail" on the log only: the gate runner owns <case>.log (stdout tail)
  // and would overwrite a same-named diagnostics file. The .json keeps its
  // stable name (pgit-real-detail.json is already owned by platform-verify).
  writeFileSync(path.join(args.evidence, `${base}-detail.log`), logLines.join("\n") + "\n", "utf8");
  writeFileSync(path.join(args.evidence, `${base}.json`), JSON.stringify(outcome.evidence, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ case: sub, verdict: outcome.failed ? "FAIL" : "PASS" }));
  process.exit(outcome.failed ? 1 : 0);
}

main().catch((e) => {
  console.log(JSON.stringify({ verdict: "FAIL", problems: [String(e?.message ?? e)] }));
  process.exit(1);
});

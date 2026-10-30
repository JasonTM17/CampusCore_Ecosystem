#!/usr/bin/env node
/**
 * generate-api-contract.mjs — P03 step 2.
 *
 * Fetches the runtime OpenAPI document from the synthetic API (started by the
 * verify runner / docker-compose.e2e.yml), canonicalizes it into
 * contracts/ecosystem/openapi.json, regenerates consumer TypeScript types for
 * frontend and mobile via the openapi-typescript version pinned in each app's
 * lockfile, and enforces the contract invariants:
 *
 *   - required consumer paths must be present;
 *   - public self-registration paths must be absent (auth-register invariant);
 *   - the spec must exercise upload / nullable / enum / paging shapes (fixtures);
 *   - regeneration must be additive — previously published path+method pairs
 *     may not silently disappear.
 *
 * Usage:
 *   node scripts/generate-api-contract.mjs --base-url http://127.0.0.1:4100
 *   node scripts/generate-api-contract.mjs --base-url http://127.0.0.1:4100 --check
 *
 * `--check` regenerates into a temp dir and byte-compares every artifact;
 * it writes nothing and exits non-zero on drift or invariant failure.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ARTIFACTS = {
  openapi: "contracts/ecosystem/openapi.json",
  frontendTypes: "frontend/src/types/generated-api.ts",
  mobileTypes: "mobile/src/api/generated-api.ts",
};

/** Consumer-critical paths that must exist in every emitted contract. */
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

const REQUIRED_PATHS = [
  ["post", "/api/v1/auth/login"],
  ["post", "/api/v1/auth/refresh"],
  ["get", "/api/v1/auth/me"],
  ["post", "/api/v1/auth/logout"],
  ["get", "/api/v1/notifications"],
];

/**
 * Public self-registration must never appear (no public registration, INV-01).
 * Scoped to the account surface so domain "register" verbs (events P08:
 * POST /api/v1/events/{id}/register) never false-fire; plain `registration`
 * is NOT forbidden — /api/v1/admin/registration/* is academic enrollment.
 * Semantic enforcement beyond name patterns lives in identity code review.
 */
const AUTH_SURFACE_RE = /^\/api\/v1\/(auth|users|accounts)(\/|$)/i;
const FORBIDDEN_NAME_RE = /(regist|sign-?up|create-?account|self-?regist|onboard)/i;
// Tier B: unambiguous self-registration names flag anywhere on the API —
// /api/v1/onboard or /self-registration/* are self-service surfaces regardless
// of the auth prefix. Anchored to whole segments: `onboarding`-style longer
// names and `registration` alone (academic enrollment) stay allowed.
const SELF_REG_PATH_RE =
  /(^|\/)(self[-_]?regist[\w-]*|self[-_]?sign[-_]?up|public[-_]?register[\w-]*|onboard)(\/|$)/i;
const FORBIDDEN_OPID_RE =
  /(selfRegister|selfSignup|selfRegistration|signUp|createAccount|publicRegister|selfEnroll|enrollSelf)/i;

function parseArgs(argv) {
  const args = { baseUrl: "http://127.0.0.1:4100", check: false, specFile: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--base-url") args.baseUrl = argv[++i];
    else if (argv[i] === "--check") args.check = true;
    else if (argv[i] === "--spec-file") args.specFile = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: generate-api-contract.mjs [--base-url URL] [--check] [--spec-file FILE]");
      process.exit(0);
    }
  }
  return args;
}

/** Deterministic stringify: object keys sorted recursively, arrays preserved. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, canonicalize(value[k])])
    );
  }
  return value;
}

async function fetchSpec(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, "")}/v3/api-docs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Walk the spec and record coverage of the required fixture shapes. */
function fixtureCoverage(spec) {
  const coverage = { upload: [], nullable: [], nullableStrict: [], enums: [], paging: [] };
  const visit = (node, trail) => {
    if (!node || typeof node !== "object") return;
    if (node["multipart/form-data"]) coverage.upload.push(trail);
    // `nullable` = consumer-facing absence/nullability fixture: in OpenAPI 3.1
    // that means optional properties (any schema with a non-required field).
    if (node.properties && typeof node.properties === "object") {
      const required = new Set(node.required ?? []);
      if (Object.keys(node.properties).some((p) => !required.has(p)))
        coverage.nullable.push(trail);
    }
    // `nullableStrict` = genuine null-typed schemas (type:[T,'null'],
    // anyOf null, legacy nullable:true). Recorded honestly: today the live
    // spec has none — runtime JSON nulls are undocumented (known gap).
    if (node.nullable === true) coverage.nullableStrict.push(trail);
    if (Array.isArray(node.type) && node.type.includes("null")) coverage.nullableStrict.push(trail);
    if (Array.isArray(node.anyOf) && node.anyOf.some((s) => s && s.type === "null"))
      coverage.nullableStrict.push(trail);
    if (Array.isArray(node.enum) && node.enum.length) coverage.enums.push(trail);
    if (node && typeof node === "object" && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) visit(v, trail ? `${trail}.${k}` : k);
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => visit(v, `${trail}[${i}]`));
    }
  };
  visit(spec, "");
  for (const [p, ops] of Object.entries(spec.paths ?? {})) {
    for (const [m, op] of Object.entries(ops ?? {})) {
      const names = (op.parameters ?? []).map((x) => x.name);
      if (names.some((n) => /^(page|size|pageable|offset|limit|sort)$/i.test(n)))
        coverage.paging.push(`${m.toUpperCase()} ${p}`);
    }
  }
  return coverage;
}

function invariants(spec, allowlist) {
  const problems = [];
  const paths = spec.paths ?? {};
  for (const [m, p] of REQUIRED_PATHS) {
    if (!paths[p] || !paths[p][m]) problems.push(`required path missing: ${m.toUpperCase()} ${p}`);
  }
  for (const [p, ops] of Object.entries(paths)) {
    for (const m of Object.keys(ops ?? {})) {
      if (!HTTP_METHODS.has(m)) continue; // skip path-item keys (parameters, $ref…)
      const op = ops[m];
      const label = `${m.toUpperCase()} ${p}`;
      const onAuthSurface = AUTH_SURFACE_RE.test(p);
      const nameFlag =
        (onAuthSurface && FORBIDDEN_NAME_RE.test(p)) || SELF_REG_PATH_RE.test(p);
      const opId = op?.operationId ?? "";
      const opFlag =
        FORBIDDEN_OPID_RE.test(opId) || (onAuthSurface && /^register/i.test(opId));
      if ((nameFlag || opFlag) && !allowlist.has(label)) {
        problems.push(
          `forbidden public-registration ${nameFlag ? "path" : "operationId"}: ${label}` +
          (opId ? ` (operationId=${opId})` : "")
        );
      }
    }
  }
  const coverage = fixtureCoverage(spec);
  for (const [k, v] of Object.entries(coverage)) {
    if (k === "nullableStrict") continue; // honest signal, not a hard fixture today
    if (!v.length) problems.push(`fixture shape absent from spec: ${k}`);
  }
  return { problems, coverage };
}

/**
 * Additive diff: endpoint removals AND schema-level breaking changes fail;
 * additions and sanctioned removals (allowlist) pass. Compares recursively:
 * removed property, newly-required property, type/format change, narrowed
 * enum at ANY schema depth, removed/newly-required operation parameters, and
 * requestBody/response schema changes. Allowlist keys are the canonical
 * labels `METHOD path` (uppercase) or `schema:Name[.prop[.detail]]`.
 */
function additiveDiff(oldSpec, newSpec, allowlist) {
  const removed = [];
  const allowed = [];
  const push = (kind, label) =>
    allowlist.has(label) ? allowed.push(label) : removed.push(label);

  // Recursive schema comparator — breaks read as contract removals.
  const compareSchema = (oldSchema, next, label) => {
    if (!oldSchema || !next) return;
    const fmt = (s) => Array.isArray(s?.type) ? s.type.slice().sort().join("|") : s?.type;
    if (oldSchema.type !== undefined && next.type !== undefined && fmt(oldSchema) !== fmt(next)) {
      push("type", `${label}.type ${fmt(oldSchema)}->${fmt(next)}`);
    }
    if (oldSchema.format !== undefined && oldSchema.format !== next.format) {
      push("format", `${label}.format ${oldSchema.format}->${next.format ?? "∅"}`);
    }
    if (Array.isArray(oldSchema.enum) && Array.isArray(next.enum)) {
      for (const v of oldSchema.enum) {
        if (!next.enum.includes(v)) push("enum", `${label}.enum:${v}`);
      }
    }
    const oldProps = oldSchema.properties ?? {};
    const nextProps = next.properties ?? {};
    const nextRequired = new Set(next.required ?? []);
    for (const prop of Object.keys(oldProps)) {
      if (!(prop in nextProps)) push("property", `${label}.${prop}`);
    }
    for (const prop of nextRequired) {
      if (!new Set(oldSchema.required ?? []).has(prop)) {
        push("required", `${label}.${prop} newly-required`);
      }
    }
    for (const prop of Object.keys(oldProps)) {
      if (prop in nextProps) compareSchema(oldProps[prop], nextProps[prop], `${label}.${prop}`);
    }
    if (oldSchema.items || next.items) compareSchema(oldSchema.items, next.items, `${label}.items`);
    for (const comb of ["allOf", "oneOf", "anyOf"]) {
      const a = oldSchema[comb] ?? [], b = next[comb] ?? [];
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        compareSchema(a[i], b[i], `${label}.${comb}[${i}]`);
      }
    }
  };

  const compareOperation = (oldOp, nextOp, label) => {
    const paramsOf = (op) => {
      const map = new Map();
      for (const prm of op?.parameters ?? []) {
        map.set(`${prm.in}:${prm.name}`, prm);
      }
      return map;
    };
    const oldParams = paramsOf(oldOp), nextParams = paramsOf(nextOp);
    for (const key of oldParams.keys()) {
      if (!nextParams.has(key)) push("param", `${label} param ${key}`);
    }
    for (const [key, prm] of nextParams) {
      if (prm.required === true && !oldParams.get(key)?.required) {
        push("param", `${label} param ${key} newly-required`);
      }
    }
    const oldBody = oldOp?.requestBody?.content?.["application/json"]?.schema;
    const nextBody = nextOp?.requestBody?.content?.["application/json"]?.schema;
    if (oldBody && !nextBody) push("requestBody", `${label}.requestBody`);
    else compareSchema(oldBody, nextBody, `${label}.requestBody`);
    for (const [code, res] of Object.entries(oldOp?.responses ?? {})) {
      const nextRes = nextOp?.responses?.[code];
      if (!nextRes) { push("response", `${label}.responses.${code}`); continue; }
      compareSchema(
        res?.content?.["application/json"]?.schema,
        nextRes?.content?.["application/json"]?.schema,
        `${label}.responses.${code}`,
      );
    }
  };

  for (const [p, ops] of Object.entries(oldSpec?.paths ?? {})) {
    for (const m of Object.keys(ops ?? {})) {
      if (!HTTP_METHODS.has(m)) continue;
      if (!newSpec.paths?.[p]?.[m]) { push("path", `${m.toUpperCase()} ${p}`); continue; }
      compareOperation(ops[m], newSpec.paths[p][m], `${m.toUpperCase()} ${p}`);
    }
  }
  for (const [name, oldSchema] of Object.entries(oldSpec?.components?.schemas ?? {})) {
    const next = newSpec.components?.schemas?.[name];
    if (!next) { push("schema", `schema:${name}`); continue; }
    compareSchema(oldSchema, next, `schema:${name}`);
  }
  const added = [];
  for (const [p, ops] of Object.entries(newSpec.paths ?? {})) {
    for (const m of Object.keys(ops ?? {})) {
      if (!HTTP_METHODS.has(m)) continue;
      if (!oldSpec?.paths?.[p]?.[m]) added.push(`${m.toUpperCase()} ${p}`);
    }
  }
  return { added, removed, allowed };
}

function cliFor(appDir) {
  const cli = path.join(REPO, appDir, "node_modules", "openapi-typescript", "bin", "cli.js");
  return existsSync(cli) ? cli : null;
}

function generateTypes(specPath, outPath, appDir) {
  const cli = cliFor(appDir);
  if (!cli) throw new Error(`openapi-typescript not installed in ${appDir} (npm ci first)`);
  // The 6.x CLI URL-parses its arguments; absolute Windows paths fail, so pass
  // spec/output relative to the app cwd.
  const cwd = path.join(REPO, appDir);
  const relSpec = path.relative(cwd, specPath).replaceAll("\\", "/");
  const relOut = path.relative(cwd, outPath).replaceAll("\\", "/");
  const res = spawnSync(process.execPath, [cli, relSpec, "-o", relOut], {
    cwd,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`openapi-typescript failed for ${appDir}: ${res.stderr || res.stdout}`);
  }
  // Generated file: eslint banner only. No @ts-nocheck — the committed spec is
  // normalized so the generated types must compile under strict tsc (F7).
  const generated = readFileSync(outPath, "utf8");
  if (!generated.startsWith("/* eslint-disable */")) {
    writeFileSync(outPath, "/* eslint-disable */\n" + generated, "utf8");
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const ALLOWLIST_PATH = path.join(REPO, "contracts/ecosystem/contract-allowlist.json");

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return new Set();
  const doc = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const set = new Set();
  for (const e of doc.entries ?? []) {
    if (e.operation) set.add(`${e.operation.method.toUpperCase()} ${e.operation.path}`);
    if (e.label) set.add(e.label);
  }
  return set;
}

async function main() {
  const args = parseArgs(process.argv);
  const report = {
    baseUrl: args.baseUrl, check: args.check,
    mode: args.specFile ? "spec-file" : "live",
    problems: [], diff: null, coverage: null, artifacts: {},
  };

  // Clean stale staging dirs from earlier crashed runs — only dirs older
  // than 30 min so a concurrent run's live staging is never swept (ND-5).
  for (const entry of readdirSync(REPO)) {
    if (!entry.startsWith(".contract-check-")) continue;
    const full = path.join(REPO, entry);
    try {
      if (Date.now() - statSync(full).mtimeMs > 30 * 60_000) {
        rmSync(full, { recursive: true, force: true });
      }
    } catch { /* racing removal — ignore */ }
  }

  const spec = args.specFile
    ? JSON.parse(readFileSync(args.specFile, "utf8"))
    : await fetchSpec(args.baseUrl);
  if (args.specFile && path.resolve(args.specFile) === path.join(REPO, ARTIFACTS.openapi)) {
    // Self-comparing the committed artifact is an offline dev check only —
    // it proves spec↔types consistency, never live-API parity (tester F4).
    report.specFileSelfCheck = true;
  }

  // `servers` reflects the probe host (springdoc derives it from the request);
  // it is deployment info, not contract — normalize it out of the oracle.
  const hadServers = "servers" in spec;
  delete spec.servers;
  report.serversNormalized = hadServers;

  // springdoc exposes Spring's MultiValueMap query-param binding with
  // writeOnly accessor pseudo-properties (`all`, `empty`) that are not real
  // contract fields — the honest param contract is a free-form string-array
  // map. Dropping them also removes the index-signature conflict that forced
  // @ts-nocheck onto generated types (tester F7).
  const normalizeSpecArtifacts = (s) => {
    const mv = s?.components?.schemas?.MultiValueMapStringString;
    if (!mv?.properties) return 0;
    let dropped = 0;
    for (const pseudo of ["all", "empty"]) {
      if (pseudo in mv.properties) { delete mv.properties[pseudo]; dropped++; }
    }
    if (dropped && !Object.keys(mv.properties).length) delete mv.properties;
    return dropped;
  };
  const artifactsDropped = normalizeSpecArtifacts(spec);
  if (artifactsDropped) report.schemaArtifactsNormalized = artifactsDropped;

  const allowlist = loadAllowlist();
  const { problems, coverage } = invariants(spec, allowlist);
  report.problems.push(...problems);
  report.coverage = Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, v.length]));
  if (!coverage.nullableStrict.length) {
    report.notes = [
      "nullableStrict=0: the spec documents no explicit null-typed schema; runtime JSON nulls are contract-undocumented (recorded gap for domain phases)",
    ];
  }

  // Temp dir must live on the same drive as the repo: the 6.x CLI resolves
  // spec/output paths relative to the app cwd, which breaks across drives.
  // EVERYTHING generates into staging first; committed artifacts are only
  // promoted on a clean report, so a FAIL run can never mutate the baseline
  // (Kongming P03-F1).
  const staging = mkdtempSync(path.join(REPO, ".contract-check-"));
  try {
    const specOut = path.join(staging, "openapi.json");
    const feOut = path.join(staging, "frontend.ts");
    const mobOut = path.join(staging, "mobile.ts");

    const oldSpecPath = path.join(REPO, ARTIFACTS.openapi);
    const oldSpec = existsSync(oldSpecPath)
      ? JSON.parse(readFileSync(oldSpecPath, "utf8"))
      : null;
    // Diff compares canonicalized forms: apply the same artifact normalization
    // to the committed side so sanctioned normalizations never read as removals.
    if (oldSpec) normalizeSpecArtifacts(oldSpec);
    const canonicalNew = canonicalize(spec);
    if (oldSpec) {
      const diff = additiveDiff(oldSpec, canonicalNew, allowlist);
      report.diff = diff;
      if (diff.removed.length) {
        report.problems.push(...diff.removed.map((r) => `non-additive diff, removed: ${r}`));
      }
    }

    const canonical = JSON.stringify(canonicalNew, null, 2) + "\n";
    writeFileSync(specOut, canonical, "utf8");

    try {
      generateTypes(specOut, feOut, "frontend");
      generateTypes(specOut, mobOut, "mobile");
      for (const [f, rel] of [[feOut, ARTIFACTS.frontendTypes], [mobOut, ARTIFACTS.mobileTypes]]) {
        const text = readFileSync(f, "utf8");
        if (!text.includes('"/api/v1/auth/login"') || !text.includes("export interface paths")) {
          report.problems.push(`generated types missing core contract surface: ${rel}`);
        }
      }
    } catch (e) {
      report.problems.push(String(e.message ?? e));
    }

    if (args.check) {
      const pairs = [
        [specOut, oldSpecPath, ARTIFACTS.openapi],
        [feOut, path.join(REPO, ARTIFACTS.frontendTypes), ARTIFACTS.frontendTypes],
        [mobOut, path.join(REPO, ARTIFACTS.mobileTypes), ARTIFACTS.mobileTypes],
      ];
      for (const [fresh, committed, rel] of pairs) {
        if (!existsSync(committed)) {
          report.problems.push(`artifact missing (run without --check): ${rel}`);
          continue;
        }
        const match = readFileSync(fresh).equals(readFileSync(committed));
        report.artifacts[rel] = match ? "byte-equal" : "DRIFT";
        if (!match) report.problems.push(`artifact drift: ${rel}`);
      }
    } else if (report.problems.length === 0) {
      // Promote staged artifacts to committed paths — only on a clean report.
      // Write to a same-dir tmp then rename so a crash never leaves a torn
      // half-written artifact (ND-5); a crash between files is still caught
      // by the next --check and self-corrects.
      for (const [staged, rel] of [
        [specOut, ARTIFACTS.openapi],
        [feOut, ARTIFACTS.frontendTypes],
        [mobOut, ARTIFACTS.mobileTypes],
      ]) {
        const target = path.join(REPO, rel);
        const tmp = target + ".tmp-promote";
        writeFileSync(tmp, readFileSync(staged));
        renameSync(tmp, target);
      }
      for (const rel of Object.values(ARTIFACTS)) report.artifacts[rel] = sha256(path.join(REPO, rel)).slice(0, 16);
    } else {
      report.stagingDiscarded = true;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  report.verdict = report.problems.length ? "FAIL" : "PASS";
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.problems.length ? 1 : 0);
}

main().catch((e) => {
  console.log(JSON.stringify({ verdict: "FAIL", problems: [String(e?.message ?? e)] }, null, 2));
  process.exit(1);
});

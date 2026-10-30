# Synthetic local capacity baseline — unmeasured

Status: NOT_RUN. This is a worksheet, not a sizing or hosting recommendation.
All measurement values are TBD. Recovery/load runtime belongs to the lead;
no drill, load, provider access or deployment was performed by this script slice.

## Measurement record

| Context | Value |
| --- | --- |
| Exact Git HEAD and owned-script hashes | TBD |
| Lead/operator and fixture provenance | TBD |
| Disposable target identity and evidence directory | TBD |
| Application/previous-image digests, schema head | TBD |
| OS, Node version and topology | TBD |
| CPU and memory limits | TBD |
| Synthetic dataset cardinalities | TBD |
| Concurrency, elapsed duration and completed requests | TBD |
| TLS setup and cold/warm procedure | TBD |
| Workload mix and route sample sizes | TBD |

| Measurement | Cold | Warm | Evidence |
| --- | --- | --- | --- |
| Process/container RSS and peak RSS | TBD | TBD | TBD |
| Heap, DB pool active/idle/waiting and connection limit | TBD | TBD | TBD |
| Queue depths and saturation | TBD | TBD | TBD |
| Throughput per route class | TBD | TBD | TBD |
| p50 latency per route class | TBD | TBD | TBD |
| p95 latency per route class | TBD | TBD | TBD |
| p99 latency per route class | TBD | TBD | TBD |
| HTTP/transport errors and redirects per route class | TBD | TBD | TBD |
| Conflict count/rate | TBD | TBD | TBD |
| Restore duration, recovered rows/FKs/blob bytes | TBD | TBD | TBD |
| Post-run invariant results | TBD | TBD | TBD |

## CLI contract and methodology

`node scripts/platform-load.mjs --help` describes the mechanical limits.
Those limits are guardrails, not measured baselines. Node must supply built-in
`fetch`, `AbortSignal.any` and `AbortSignal.timeout`; no external dependencies.
Supply all required options explicitly:

```text
node scripts/platform-load.mjs --base-url <loopback-origin> --scenario mixed-academic --fixture synthetic --concurrency <approved-positive-integer> --duration-seconds <approved-positive-integer> --out <owned-evidence-directory> [--invariant-hook <trusted-local.mjs>]
```

Only HTTP(S) origins with literal `localhost` or `127.0.0.1` are accepted.
No credentials, path prefixes, query, fragment, alternate numeric IP forms or
remote hostnames. `localhost` is pinned to the literal IPv4 loopback address
before requests, preventing DNS escape. HTTPS therefore needs a trusted
certificate valid for that literal address; no TLS verification bypass is
provided. Redirects are recorded as errors and never followed. Configure a
direct local listener rather than an edge redirect. The lead must verify that
listener has only synthetic data and does not proxy production or providers.
The fixture flag is an explicit attestation; the CLI neither seeds nor proves
fixture provenance. Do not run while the shared runtime lane is occupied.

`mixed-academic` rotates equally through read-only academic sections, library
catalogue, events and careers opportunity endpoints. It supplies a synthetic
fixture header. For protected routes, the lead may supply a synthetic principal's
token non-echoingly through process environment `ECO_LOAD_BEARER_TOKEN`.
The script forwards it only to the pinned loopback origin, never logs it, and
does not read an env file or obtain/refresh credentials. No token means no
Authorization header. Unauthorized/forbidden responses count
as HTTP errors; a denial-only run is not a successful capacity measurement.
It does not measure registration writes, lock contention, authenticated user
journeys, assistant/provider work or mutation conflict correctness. Any broader
scenario needs a separate lead-owned contract and synthetic fixture.

The report `platform-load.json` separates requests, request errors, HTTP errors,
transport/body errors, conflicts, redirects and throughput per route class.
An errored request is counted once in total errors; HTTP and transport categories
can overlap when an error response also fails during body consumption. Percentile
latencies include failures and body consumption, using a bounded millisecond
histogram with a documented overflow bucket. No samples means null percentile,
never a fabricated measurement. Bodies are streamed and discarded with a hard
size limit; no response text or credentials are logged. Requests are aborted at
the workload deadline; deadline cancellations remain counted as transport errors.
Record that tail effect when interpreting short runs. Process shutdown and the
separate hook timeout may extend wall-clock time beyond the workload window.

The optional `--invariant-hook` is a trusted lead-owned local module executed
as a separate Node process after the workers stop. It receives JSON on stdin:
effective `baseUrl`, `scenario`, `fixture`, and `routeClasses`. Independently
compare pre/post fixture row counts and FK/orphan state, capacity counters and
expected side effects using privately supplied evidence. A post-only check
without a pre-run reference cannot prove preservation. Emit a JSON object
with `status: "PASS"` and exit successfully only on verified invariants.
Hook output/errors are discarded; malformed output, timeout or failure marks
the check FAIL. Its fixed timeout/output cap is separate from workload limits.
Review hook code for target safety and child cleanup: arbitrary hook code is
outside the fetch loop's containment. Missing hook is explicitly NOT_RUN.

Exit codes: zero requires error-free sampled routes and a passing invariant
hook; one reports observed failures; two rejects invalid configuration or local
capability; four means otherwise clean workload with invariants NOT_RUN.
The JSON verdict is PASS, FAIL or INCOMPLETE accordingly. A mechanical PASS
does not imply an approved latency SLO or successful full-platform workload.

## Lead runtime checklist

- Freeze exact source, approved synthetic fixture and disposable target;
  reserve the shared runtime lane and confirm direct local routing.
- Record idle/cold metrics, then run the approved bounded workload. Repeat a
  warm run only under the approved measurement budget. Save scoped RSS/pool/
  queue evidence separately; the CLI does not collect those metrics itself.
- Review per-route sample counts, latency/error data, invariant receipt and
  restore checks. Populate this worksheet only from retained exact receipts.
- Retain missing gates as NOT_RUN; choose hosting/topology only after owner
  review of measured demand, resource limits and recovery policy.

Encryption/offsite restore and real blob/provider proof remain separately
authorized. See [recovery contract](../../ops/backup/README.md).

## Unresolved questions

Approved workload/SLO envelope, synthetic dataset, runtime hooks and evidence,
operator recovery policy and offsite destination: TBD, lead-owned. No numeric
baseline or claim that a particular memory tier fits is accepted here.

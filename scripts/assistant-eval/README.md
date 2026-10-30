# Assistant Evaluation Framework (AUD-16)

Deterministic, offline bilingual evaluation corpus, report schema, and grading runner for the CampusCore University Assistant.

## Overview

- **Corpus (`corpus.json`)**: Versioned, deterministic corpus of 68 synthetic test cases (34 Vietnamese, 34 English) covering:
  - Grounded answers with authoritative expected facts and a citation oracle (`sourceId` and `slug`).
  - Refusals (out-of-scope queries and requests for other students' private records).
  - PII requests (personal phone numbers, student IDs, credential/password exfiltration).
  - Prompt-injection attempts (in-question jailbreaks, DAN mode, SQL exfiltration, and indirect injection in retrieved text).
  - Long-context and Vietnamese diacritics edge cases (unaccented, NFD combining accents, mixed case, softened learning contexts).
  - Protocol expectations (SSE event sequence `meta>(delta|replace)+>done`, idempotency replay flags, and quota exhaustion with `QUOTA_EXCEEDED` and `resetAt`).
  - **Synthetic data only**: Zero real student IDs, names, or contact numbers.
- **Report Schema (`report.schema.json`)**: JSON Schema definition enforcing report metadata, per-case verdict (`PASS`, `FAIL`, `SKIPPED`), latency, token counts, mode (`lexical`, `stub`, `live`), thresholds, and summary statistics.
- **Evaluation Runner (`runner.mjs`)**: Evaluates responses offline using stub mock generation or lexical grading. Provides an explicit safety gate refusing live provider execution unless authorized.

## Execution Modes

1. **`stub` (default offline)**: Runs deterministic built-in mock responses verifying all 68 test cases without network or credentials.
   ```bash
   node scripts/assistant-eval/runner.mjs --mode stub
   ```
2. **`lexical` (offline grading)**: Grades recorded or provided assistant responses against facts, forbidden text, reason codes, and citation oracles.
3. **`live` (provider mode — GATED)**:
   - Live provider execution is **strictly refused by default** and reports `NOT_RUN` with all cases `SKIPPED`.
   - Requires explicit opt-in via the environment variable `CAMPUSCORE_ASSISTANT_LIVE_EVAL_PERMITTED`.
   - Never commit or print credentials, secrets, or values for this variable into source control.

## Quality Thresholds

| Metric | Threshold | Description |
|---|---|---|
| `minPassRate` | `>= 0.95` (95%) | Minimum acceptable pass rate across evaluated cases |
| `maxLatencyMs` | `<= 15000` ms | Maximum permitted latency for any turn |
| `p95LatencyMs` | `<= 8000` ms | 95th percentile turn latency |
| `minCitationRecall` | `>= 0.90` (90%) | Minimum recall for authoritative citation sourceIds in grounded cases |

## Verification

Run the test suite:
```bash
node --test scripts/assistant-eval/assistant-eval.test.mjs
```

Run dry-run probe matrix:
```bash
node scripts/probe-assistant-matrix.mjs --dry-run
```

Run secret hygiene gate:
```bash
node scripts/check-assistant-secrets.mjs
```

# RAG contract template

Copy into the consuming project's plan. Replace every placeholder; leave an
unknown as `proposed` or `BLOCKED_CAPABILITY`, not an invented approval.

## Decision authority

- Product goal / owner / use cases:
- Corpus owner, approved purpose, consent/license, privacy class, retention:
- Source of truth, source revision and per-source ACL authority:
- Tenant/actor identities and policy revision:
- Provider/region/data-processing approval:
- Answer, citation, abstention and streaming policy:
- Freshness, latency, cost and quality budgets with approver:
- Rollback and incident owner:

## Versioned pipeline

- Source ID and revision format; tombstone/high-water authority:
- Parser/chunker/embedding revisions and deterministic chunk ID/digest:
- Staging manifest, idempotency key, atomic promotion and active snapshot:
- Query-time ACL prefilter and authoritative pre-context/final-publication checks:
- Citation ID/revision/span resolution and unsupported-claim behavior:

## Trace and verification

Use the shared `source -> rule -> use case -> change -> test -> evidence`
contract. Assign `RAG-01`–`RAG-08` to project-owned confirmed rules or mark
inapplicable with reason. For each case record case ID/revision, actor/grants,
query, allowed/forbidden chunks, gold support or abstention, fault timing,
observed retrieval/answer/citations, status and redacted receipt/snapshot.

| Rule | Use case | Change owner/path | Test command and oracle | Evidence level/status |
|---|---|---|---|---|
| RAG-01 | | | | NOT_RUN |
| RAG-02 | | | | NOT_RUN |
| RAG-03 | | | | NOT_RUN |
| RAG-04 | | | | NOT_RUN |
| RAG-05 | | | | NOT_RUN |
| RAG-06 | | | | NOT_RUN |
| RAG-07 | | | | NOT_RUN |
| RAG-08 | | | | NOT_RUN |

Record separate retrieval, grounding, citation, access/freshness, recovery,
latency and cost denominators. Freeze baseline/candidate case set and oracle.
State provider, database, browser and operating-system evidence separately.

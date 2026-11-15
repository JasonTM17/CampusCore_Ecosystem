# RAG source and access (WF-11)

This is a synthetic, isolated example. The fixture owner confirms `BR-11`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** ai changes involving rag source and access.
- **Inputs:** query, tenant, source ACL, index revision; accepted policy/source revision and actor authority.
- **Owner:** AI owner + security reviewer. Controller owns plan/checkpoint state.
- **Rule BR-11:** Only authorized cited sources may support an answer at response time.
- **Invariant:** no cross-tenant source in answer.
- **Trace:** fixture source → `BR-11` → `WF-11` → simulation handler →
  `WF-11-SUCCESS`, `WF-11-DENIED`, `WF-11-RECOVERY`,
  `WF-11-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-11-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-11-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-11-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Revocation during retrieval `WF-11-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only rag-source-access` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only rag-source-access`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** Retrieval for team A returns and cites indexed `doc-a`.
Cross-tenant, forged same-tenant and empty source lists are rejected. An index
outage prevents retrieval until retry. Revoking the grant after retrieval
blocks answer generation. This does not evaluate a live model or citation text.

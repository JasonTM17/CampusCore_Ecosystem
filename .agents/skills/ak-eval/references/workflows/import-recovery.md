# Import and migration recovery (WF-08)

This is a synthetic, isolated example. The fixture owner confirms `BR-08`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** integration and data changes involving import and migration recovery.
- **Inputs:** source revision, row IDs, checkpoint; accepted policy/source revision and actor authority.
- **Owner:** data owner + data integrity reviewer. Controller owns plan/checkpoint state.
- **Rule BR-08:** A resumed import applies each valid row once from a durable checkpoint.
- **Invariant:** no duplicate row and checkpoint monotonic.
- **Trace:** fixture source → `BR-08` → `WF-08` → simulation handler →
  `WF-08-SUCCESS`, `WF-08-DENIED`, `WF-08-RECOVERY`,
  `WF-08-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-08-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-08-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-08-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Competing workers `WF-08-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only import-recovery` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only import-recovery`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** Rows 1 and 2 advance the checkpoint to 2. A row for
another tenant is rejected. After row 1, replaying it is a no-op and row 2
resumes progress. A second worker carrying the old version cannot advance the
checkpoint. The fixture has no real migration transaction or durable storage.

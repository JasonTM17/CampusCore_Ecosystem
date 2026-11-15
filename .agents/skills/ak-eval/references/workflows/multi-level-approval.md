# Multi-level approval (WF-01)

This is a synthetic, isolated example. The fixture owner confirms `BR-01`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** business process changes involving multi-level approval.
- **Inputs:** request, actor roles, policy revision; accepted policy/source revision and actor authority.
- **Owner:** business-analyst + implementation owner. Controller owns plan/checkpoint state.
- **Rule BR-01:** Only distinct authorized approvers may advance their own ordered level.
- **Invariant:** level order and one decision per level.
- **Trace:** fixture source → `BR-01` → `WF-01` → simulation handler →
  `WF-01-SUCCESS`, `WF-01-DENIED`, `WF-01-RECOVERY`,
  `WF-01-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-01-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-01-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-01-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Parallel approvals `WF-01-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only multi-level-approval` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only multi-level-approval`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** Lead approves level 1, then director approves level 2.
Requester approval, unauthorized replay of an existing key, and key reuse for
another level are rejected. Repeating the same authorized key leaves version 1;
a competing approval carrying the old version cannot advance the level.

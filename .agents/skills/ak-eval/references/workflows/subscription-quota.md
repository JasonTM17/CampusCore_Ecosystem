# Subscription quota accounting (WF-06)

This is a synthetic, isolated example. The fixture owner confirms `BR-06`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** authorization and limits changes involving subscription quota accounting.
- **Inputs:** period, plan limit, usage key; accepted policy/source revision and actor authority.
- **Owner:** billing owner + data integrity reviewer. Controller owns plan/checkpoint state.
- **Rule BR-06:** Usage is idempotent and must not exceed the period limit.
- **Invariant:** used units never exceed limit.
- **Trace:** fixture source → `BR-06` → `WF-06` → simulation handler →
  `WF-06-SUCCESS`, `WF-06-DENIED`, `WF-06-RECOVERY`,
  `WF-06-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-06-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-06-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-06-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Competing usage `WF-06-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only subscription-quota` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only subscription-quota`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** Usage of 4 plus 6 reaches the period limit of 10.
Another tenant is denied. Repeating key `q1` for 4 consumes nothing extra;
reusing it for 5 is rejected. A competing 7-unit request carrying the old
version cannot push usage over the limit.

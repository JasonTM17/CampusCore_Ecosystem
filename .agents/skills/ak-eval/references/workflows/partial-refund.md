# Payment and partial refund (WF-03)

This is a synthetic, isolated example. The fixture owner confirms `BR-03`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** transactions changes involving payment and partial refund.
- **Inputs:** capture ID, amount, refund key, tenant; accepted policy/source revision and actor authority.
- **Owner:** integration owner + data integrity reviewer. Controller owns plan/checkpoint state.
- **Rule BR-03:** Captured value bounds all refunds; a key replays only its original amount.
- **Invariant:** sum of refunds never exceeds capture.
- **Trace:** fixture source → `BR-03` → `WF-03` → simulation handler →
  `WF-03-SUCCESS`, `WF-03-DENIED`, `WF-03-RECOVERY`,
  `WF-03-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-03-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-03-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-03-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Concurrent refund requests `WF-03-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only partial-refund` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only partial-refund`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** Two refunds of 40 and 60 exhaust a capture of 100.
A cross-tenant refund is denied. Replaying key `r1` for 40 changes no balance;
reusing it for 50 is rejected. A second competing refund using an old version
cannot exceed the captured total.

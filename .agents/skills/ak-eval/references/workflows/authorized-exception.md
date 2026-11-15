# Authorized exception (WF-02)

This is a synthetic, isolated example. The fixture owner confirms `BR-02`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** business process changes involving authorized exception.
- **Inputs:** exception request, reason, approver scope, expiry; accepted policy/source revision and actor authority.
- **Owner:** business-analyst + authority owner. Controller owns plan/checkpoint state.
- **Rule BR-02:** An exception requires a scoped approver, recorded reason and active validity.
- **Invariant:** no privilege from an expired/revoked exception.
- **Trace:** fixture source → `BR-02` → `WF-02` → simulation handler →
  `WF-02-SUCCESS`, `WF-02-DENIED`, `WF-02-RECOVERY`,
  `WF-02-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-02-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-02-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-02-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Revocation during approval `WF-02-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only authorized-exception` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only authorized-exception`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** The exception owner grants team A a reasoned exception
through time 20, usable at time 11. A member cannot grant it. Use at time 21
fails, revocation clears it, and approval carrying the version from before
revocation is rejected.

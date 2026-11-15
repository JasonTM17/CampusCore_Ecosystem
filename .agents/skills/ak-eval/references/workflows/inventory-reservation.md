# Competing inventory reservation (WF-04)

This is a synthetic, isolated example. The fixture owner confirms `BR-04`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** transactions changes involving competing inventory reservation.
- **Inputs:** stock, hold TTL, tenant, request ID; accepted policy/source revision and actor authority.
- **Owner:** inventory owner + data integrity reviewer. Controller owns plan/checkpoint state.
- **Rule BR-04:** A committed hold consumes one available unit and expiry returns it once.
- **Invariant:** stock plus active holds is conserved.
- **Trace:** fixture source → `BR-04` → `WF-04` → simulation handler →
  `WF-04-SUCCESS`, `WF-04-DENIED`, `WF-04-RECOVERY`,
  `WF-04-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-04-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-04-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-04-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Competing holds `WF-04-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only inventory-reservation` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only inventory-reservation`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** One reservation consumes the only unit. A different
tenant cannot reserve it. Repeating the hold and its expiry changes stock only
once each. A second reservation with a stale version cannot take the unit.
This fixture models counters and holds; it does not execute a database lock.

# Duplicate and out-of-order webhook (WF-07)

This is a synthetic, isolated example. The fixture owner confirms `BR-07`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** integration and data changes involving duplicate and out-of-order webhook.
- **Inputs:** signature, event ID, aggregate version; accepted policy/source revision and actor authority.
- **Owner:** integration owner. Controller owns plan/checkpoint state.
- **Rule BR-07:** Apply authenticated unique events in version order; duplicates are no-ops.
- **Invariant:** one effect per event ID and monotonic version.
- **Trace:** fixture source → `BR-07` → `WF-07` → simulation handler →
  `WF-07-SUCCESS`, `WF-07-DENIED`, `WF-07-RECOVERY`,
  `WF-07-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-07-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-07-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-07-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Duplicate delivery `WF-07-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only webhook-ordering` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only webhook-ordering`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** Versions 1 and 2 each produce one effect. An
unauthenticated event or non-integer version is rejected. Exact event-ID replay
is a no-op; reuse of that ID for another version is rejected. Version 2 may
wait for version 1, but another ID claiming pending version 2 cannot replace it.

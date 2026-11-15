# Agent tool with side effects (WF-12)

This is a synthetic, isolated example. The fixture owner confirms `BR-12`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** ai changes involving agent tool with side effects.
- **Inputs:** tool grant, action key, tenant; accepted policy/source revision and actor authority.
- **Owner:** AI owner + tool authority reviewer. Controller owns plan/checkpoint state.
- **Rule BR-12:** A side effect needs current scope and one durable idempotency key.
- **Invariant:** at most one effect per action key.
- **Trace:** fixture source → `BR-12` → `WF-12` → simulation handler →
  `WF-12-SUCCESS`, `WF-12-DENIED`, `WF-12-RECOVERY`,
  `WF-12-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-12-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-12-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-12-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Concurrent tool calls `WF-12-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only agent-tool-effect` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only agent-tool-effect`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** An authorized create action records one effect. Another
tenant is denied. Replaying the same key and payload records nothing more;
changing the payload for that key is rejected. Revocation advances the grant
epoch, so a call with the prior epoch cannot create another effect.

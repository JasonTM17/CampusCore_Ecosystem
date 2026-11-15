# Tenant isolation and revocation (WF-05)

This is a synthetic, isolated example. The fixture owner confirms `BR-05`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** authorization and limits changes involving tenant isolation and revocation.
- **Inputs:** tenant, grant version, principal; accepted policy/source revision and actor authority.
- **Owner:** auth owner + security reviewer. Controller owns plan/checkpoint state.
- **Rule BR-05:** A request must match tenant and a current grant version.
- **Invariant:** revoked access never succeeds.
- **Trace:** fixture source → `BR-05` → `WF-05` → simulation handler →
  `WF-05-SUCCESS`, `WF-05-DENIED`, `WF-05-RECOVERY`,
  `WF-05-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-05-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-05-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-05-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Revocation during request `WF-05-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only tenant-revocation` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only tenant-revocation`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** Team A accesses with grant version 1; team B is denied.
Revocation increments the grant version and blocks the old token, including a
token read immediately before revocation. This checks the response-time grant
guard in the fixture, not a deployed authorization service.

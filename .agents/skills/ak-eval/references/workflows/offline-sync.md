# Offline sync conflict (WF-09)

This is a synthetic, isolated example. The fixture owner confirms `BR-09`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** mobile and desktop changes involving offline sync conflict.
- **Inputs:** local edit, remote revision, tenant; accepted policy/source revision and actor authority.
- **Owner:** mobile owner. Controller owns plan/checkpoint state.
- **Rule BR-09:** Conflicting offline edits require explicit resolution and current access.
- **Invariant:** no silent overwrite of newer remote data.
- **Trace:** fixture source → `BR-09` → `WF-09` → simulation handler →
  `WF-09-SUCCESS`, `WF-09-DENIED`, `WF-09-RECOVERY`,
  `WF-09-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-09-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-09-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-09-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Interrupted sync `WF-09-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only offline-sync` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only offline-sync`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** An edit based on revision 1 writes `local-v2` and
advances to revision 2. Another tenant is denied. Replaying the same edit key
does not advance again. If a remote edit wins first, the stale offline edit
requires a merge rather than overwriting the remote body.

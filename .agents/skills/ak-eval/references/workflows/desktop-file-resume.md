# Interrupted desktop file task (WF-10)

This is a synthetic, isolated example. The fixture owner confirms `BR-10`
for this example only; a consuming product must obtain its own source and approval.

- **When to use:** mobile and desktop changes involving interrupted desktop file task.
- **Inputs:** target path, content digest, journal ID; accepted policy/source revision and actor authority.
- **Owner:** desktop owner. Controller owns plan/checkpoint state.
- **Rule BR-10:** Only owned paths may be atomically published after a verified write.
- **Invariant:** published file matches committed digest.
- **Trace:** fixture source → `BR-10` → `WF-10` → simulation handler →
  `WF-10-SUCCESS`, `WF-10-DENIED`, `WF-10-RECOVERY`,
  `WF-10-CONTENTION` → run receipt.
- **Checkpoints:** confirm rule authority before implementation; run scoped cases
  before completion; check receipt freshness against changed scope at acceptance.
- **Stop:** missing source authority, ambiguous owner, failed invariant, or
  unavailable runtime/provider needed for a real-world claim.

| Case | Expected outcome |
|---|---|
| Success `WF-10-SUCCESS` | Authorized path reaches the intended state. |
| Denied `WF-10-DENIED` | Unauthorized actor/tenant/path leaves state unchanged. |
| Failure and recovery `WF-10-RECOVERY` | Injected fault or lost acknowledgement resumes without duplicate effect. |
| Competing resume `WF-10-CONTENTION` | Invariant holds across competing or interrupted actions. |

Run `node ../../scripts/run-workflows.cjs --only desktop-file-resume` from this file's
directory, or `node engineer/skills/ak-eval/scripts/run-workflows.cjs --only desktop-file-resume`
from a repository root. This reports simulation evidence only. Connect the
product's actual implementation, database/OS/browser/provider and role tests to
new rule IDs and receipts before asserting product acceptance.

**Fixture sequence:** Stage an owned path, then publish only with its staged
digest. Parent traversal is rejected. If another stage replaces the content,
the first digest cannot publish it; the final digest can resume. A competing
publish with an old version fails. This in-memory fixture does not prove OS
atomic rename, crash durability or a real file journal.

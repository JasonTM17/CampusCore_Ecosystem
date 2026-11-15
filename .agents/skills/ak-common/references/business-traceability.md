# Business trace and handoff contract (v1)

Use for changes with business rules, multiple roles/states, integrations or data
invariants. A small mechanical edit can use its existing task and focused check.
The controller owns the plan, decisions and checkpoint acceptance.

Trace: source -> rule -> use case -> change -> test -> evidence. Assign stable IDs
and record version/revision, not just a link that may change. Sources need an
authority; rules are confirmed, proposed or disputed. Only an authorized decision
can confirm a rule. Sample fixture owners confirm illustrative rules only.

The JSON contract is validated by `../scripts/workflow-contract.cjs`:

- `version: 1`, `owner`, `sources` (id, locator, revision, authority).
- `rules` (id, sourceIds, statement, status, confirmedBy when confirmed).
- `actors` (id, role); `useCases` (id, ruleIds, actorIds, precondition,
  postcondition, failureRecovery, invariant).
- `changes` (id, useCaseIds, owner, portable paths).
- `tests` (id, ruleIds, useCaseIds, changeIds, commandId, explicit oracle).
- `evidence` (id, testIds, status, level, receipt for PASS, reason otherwise).

`--checkpoint` rejects unresolved rules, changes without tests and tests without PASS references. It
checks structure; **also run the evidence freshness gate** against the expected
command and snapshot. A path in JSON is not proof that a test ran.

Handoff JSON: plan, step, owner, snapshot, allowedWrites, changedPaths, evidence,
blockers, status, next, and `planStateOwner: controller`. The controller supplies
a separate assignment JSON containing plan, step, owner and allowedWrites.
Validate with `node workflow-contract.cjs handoff.json --handoff --assignment assignment.json`.
The worker cannot enlarge that assignment or write plan/phase/ledger state even
when a broad directory was assigned. This checks structure and ownership;
actual receipts and freshness still require the workflow checkpoint.
Workers can read related contracts across phases, but only write their assigned
paths. Report proposed plan updates without editing phase state. Stop on missing
authority, ambiguous ownership or failed prerequisites; name the receiving owner.

Evidence levels are static, simulation, runtime, provider. All use PASS, FAIL,
NOT_RUN or BLOCKED_CAPABILITY. Preserve the weakest relevant gate in acceptance;
simulation evidence never proves a production database, browser or provider.

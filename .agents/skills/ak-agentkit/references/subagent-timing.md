# Subagent Timing

When to spawn installed agents, what every delegation must carry, what may run
in parallel, and how dispatch differs per runtime. Roles here are resolved
against the LIVE installed inventory (Step 2) — example agent names are
illustrations from common AgentKit installs, not a roster to assume.

## Current gate corrections (authoritative)

The current rules below override conflicting trigger, dispatch and escalation
examples in the retained reference. Every legacy trigger is a candidate only;
apply the project delegation gate before dispatch. Named roles required by the
selected workflow remain required. Historical fixed startup-time estimates
are unverified for the active runtime and must not be used as measurements.

Keep every role explicitly required by the selected original workflow. Outside
those roles, single-agent execution is the default. The project delegation gate
is authoritative; this reference never grants additional authority.

## Decision Points

| Condition | Owner / action |
|---|---|
| Outcome, scope or trade-off ambiguity | Advisor before a scope change |
| Architecture or sequencing assumption invalidated | Kongming, bounded independent advice |
| Falsifiable load-bearing risk claim | Wukong, read-only, explicit invariant and evidence boundary |
| Missing specialist capability required by current step | Available specialist for that slice |
| Disjoint work removes a real critical-path delay | Bounded workers only if integration cost is lower |
| Selected workflow requires test/review/finalization | Retain those named roles and checkpoints |
| Routine search, status, edit or test command | Controller, unless already owned by a required role |

Size, file count, domain count, available slots and implementation completion do
not independently authorize spawning. A missing required role is
BLOCKED_CAPABILITY, never an invented independent approval.

## Delegation Contract

Before spawning, state the passed condition, active plan/current step, why the
controller cannot efficiently own the slice, exact read/write scope, forbidden
scope, deliverable, evidence requirement and stop condition. Workers are not
alone in the checkout; preserve others' changes. No nested delegation.

Inputs: source requirements, accepted rules and relevant contracts, target
snapshot, ownership, exact verification budget and unresolved decisions.
Outputs: PASS / FAIL / BLOCKED_CAPABILITY / NOT_RUN, changed paths, command and
scope, snapshot, actual results, limitations, proposed status and next handoff.
The controller alone integrates changes and updates plan/phase state.

## Runtime and Parallel Safety

Discover the runtime's actual collaboration surface before use. Prefer native
agent tools when exposed, otherwise an explicitly configured bridge. Do not
assume every Codex dispatch creates a CLI subprocess or has fixed latency.

Independent workers require disjoint writes; relevant integration contracts can
be read across phases. Reviewers remain read-only on a frozen snapshot. No agent
may merge, publish or change another worker's scope without authority. User
communication and decisions remain with the controller.

After two failed cause-aligned repairs, use one appropriate specialist-guided
attempt if the gate passes; then report a concrete blocker. Do not recursively
bounce between Advisor, Kongming, Wukong and implementers.

## Retained reference examples

The original mechanisms, task brief fields, safety checklist, runtime examples
and role handoffs follow for compatibility. Apply the current corrections above
first; these examples do not independently grant authority or runtime support.

## Why (and why not) delegate

A subagent adds value through exactly four mechanisms: a fresh context window
(no accumulated noise), an enforced tool boundary, parallel wall-clock, or a
specialist system prompt. If a spawn provides none of these, do the work
inline.

Do NOT spawn when:

- The work is a single small edit or lookup (delegation overhead > work).
- The task needs the full conversation history to be done right — subagents
  start blank; the contract below is ALL they know.
- The user is mid-dialogue on the same question (interactive loops stay in
  the controller).
- On Codex, the work is smaller than the per-dispatch subprocess cost (each
  call is a fresh `codex exec`, roughly 1-3s before first token).

## Trigger Table

| Stage | Condition | Role (examples) |
|---|---|---|
| understand | More than two areas/files to map | explorer, read-only, in parallel (`Explore`, `scout`) |
| understand | External tech or unknown API involved | researcher (`researcher`) |
| decide | size epic, multi-file build ahead | planner (`planner`) — prefer the planning skill instead when the user should review the plan |
| decide | Approach contested or high-stakes | second-opinion role (`brainstormer`) with an adversarial prompt |
| execute | Independent file sets across phases | implementer per phase (`fullstack-developer`), disjoint ownership, parallel only when files do not overlap |
| execute | Marketing: multiple channels from one brief | one content role per channel (`content-creator`, `copywriter`, `email-wizard`, `social-media-manager`) |
| verify | Implementation or fix just finished | tester (`tester`) before claiming done |
| verify | Ship/publish/public-contract ahead, or risk high | independent reviewer (`code-reviewer`, `content-reviewer`) |
| any | Same failure twice despite fixes and the expected mechanism is known | debugger with all evidence so far (`debugger`, `campaign-debugger`) |
| any | Hard problem on a model below `fable` (stuck after retries, high-stakes fork) | strategist (`kongming`) — autonomous counsel from the strongest model in one reply; no user round-trips |
| any | High-risk claim is assumption-heavy, evidence conflicts, reviewers disagree, portability is claimed, or two reasonable fixes failed | adversarial investigator (`wukong`) at R0 — falsify, minimize, grade evidence, and hand off; never implement or sign off |
| deliver | Behavior, setup, or commands changed | docs role (`docs-manager`) |
| deliver | Durable lesson, incident, or hard failure worth recording | journal role (`journal-writer`) |
| any | Data pull or analysis too large for the main context | analyst (`analytics-analyst`, `database-admin`) |

Timing beats selection: the most common failure is the right agent spawned
late (explorers after you are lost, reviewer after the PR is open). Spawn at
the trigger, not at the regret.

Pass `model` explicitly on every spawn. `kongming` runs on its pinned
Opus-tier model; use `fable` only when the user names it.

If the expected behavior or mechanism is contested, or a Debugger fix has not
survived adversarial probing, use Wukong alongside the owning Debugger/Test
workflow. Keep the worktrees frozen for independent read-only probes and never
let Wukong become the implementation or release approver.

## Delegation Contract

Every spawn carries all seven. A subagent cannot see the conversation; this
contract is its entire world:

1. **Task** — one outcome, verifiable.
2. **Files to read** — exact paths, not "look around" (unless scouting IS the task).
3. **Files it may modify** — explicit ownership; empty for read-only roles.
4. **Acceptance criteria** — how the agent knows it is done.
5. **Constraints** — patterns to follow, things not to touch, no commit/push
   unless the controller owns git ops and says so.
6. **Report path** — where to write findings when the project keeps reports
   (`plans/reports/` convention when present); otherwise return in the result.
7. **Status line** — end with `Status: DONE | DONE_WITH_CONCERNS | BLOCKED |
   NEEDS_CONTEXT` plus a one-line summary.

Handle `BLOCKED` / `NEEDS_CONTEXT` by changing the context, scope, or approach
before re-delegating. Re-sending a failing prompt unchanged is a loop, not a
retry.

## Parallel Safety

- Parallel agents require disjoint file ownership, decided BEFORE spawning.
- Never parallel-edit the same file, generated artifact, migration sequence,
  or shared config.
- Read-only explorers parallelize freely.
- Merge decisions, conflict resolution, and user approvals stay in the
  controller session.
- Keep concurrent spawns to a handful (3-4); a wall of agents burns quota and
  produces reports faster than you can verify them.

## Runtime Dispatch Dialects

**Claude Code**

- Spawn: `Agent` tool with `subagent_type: "<agent-name>"`; available names
  are the installed subagent types listed in your context.
- Semantics: fresh context, frontmatter tool allowlist enforced, one text
  result returned. Parallel = multiple Agent calls in a single message.
- Skills invoke via the Skill tool (`/ak:<slug>`).

**Codex**

- Spawn: call the `agent_<slug>` MCP tool with a `prompt` argument when the
  `ak-codex-agent-runtime` MCP server is registered; each call runs a fresh
  `codex exec` subprocess with the agent's instructions.
- Not registered? Run `ak codex-agent-runtime register`, restart Codex, or do
  the work inline this session. Discover installed agents by listing
  `~/.codex/agents/` or the project's `.codex/agents/`.
- Semantics: subprocess per call (~1-3s start), sandbox derived from the
  agent's tool allow-list, result returned as tool output.

**Neither available** — do the work inline and name the gap in the final
report; never fake a delegation.

## Advisor, Kongming, and Wukong

Keep these roles ordered and non-circular:

1. Advisor interviews/reframes when user intent or requirements are ambiguous.
2. Kongming independently advises on strategic or architectural choices.
3. Wukong attacks one concrete load-bearing claim with bounded evidence.

Kongming may supervise Wukong's framing and interpret residual risk, but does
not run the probes for it. Wukong may hand an underdefined mission back to
Advisor or a strategic conflict to Kongming; it never recursively delegates to
either. A Wukong verdict is not Test, Security, Review, or release sign-off.

## Reporting Back

The controller reports outcome-first after agents return: what each role
produced, what was verified, which reports exist where, and any
`DONE_WITH_CONCERNS` items verbatim — concerns from fresh-context agents are
signal, not noise.

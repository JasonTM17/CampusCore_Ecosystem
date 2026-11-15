---
name: ak:plan-lock
description: "Additive execution guardrails for accepted AgentKit plans. Preserves the selected workflow and all required roles while preventing speculative replanning, duplicate subagents, repeated broad tests, and unbounded repair loops."
user-invocable: true
when_to_use: "Apply alongside cook, fix, vibe, orchestrate, team, or another implementation workflow once a plan or bounded outcome has been accepted."
category: utilities
keywords: [plan-lock, execution, workflow, delegation, testing, quota, resume]
argument-hint: "[plan-path]"
metadata:
  author: agentkit
  version: "1.0.0"
---

# Plan Lock - Additive Execution Overlay

This skill only adds execution bounds. It does not remove, rename, skip, or
replace any original AgentKit workflow stage, required subagent, approval gate,
test gate, review gate, finalization step, routing table, or reference.

## Preserve the selected workflow

Run the original selected workflow from start to finish. Keep its required
planner, scout, UI, tester, debugger, reviewer, project-management, docs, git,
Advisor, Kongming, Wukong, and specialist roles exactly where that workflow
requires them. The overlay limits extra ceremony around those roles; it does
not make a required role optional.

## Execute the accepted plan forward

1. Resolve the active plan and its first incomplete step.
2. Load the Outcome Contract, global constraints, current step, and exit
   criterion. Read older detail only when the current step depends on it.
3. Take the smallest reversible action that advances the current step.
4. Record evidence and continue to the next incomplete step.
5. Pause only at an original workflow gate, a user-decision boundary, an
   external-authority boundary, or a concrete blocker.

Do one bounded consistency sweep before the first implementation edit. During
execution, treat harmless wording clarification as an execution ruling. Do not
reopen settled design choices or restart planning merely to seek a nicer
alternative.

For multi-phase or long-running work, keep
`plans/<plan-id>/reports/execution-ledger.md`. Its first non-heading line must
name the repo-relative active plan. Record completed steps and evidence,
current step, authorized rulings, deferred findings, and the next resume point.
After interruption, verify plan identity and resume from the first incomplete
step without replaying evidence-backed completed work.

## Bound additional delegation

Every role required by the original workflow remains required. Beyond those
roles:

- Do not spawn duplicate agents for unchanged evidence or to occupy available
  concurrency.
- One invocation per required role per named checkpoint is the default.
- Multiple agents require explicit parallel execution with disjoint ownership,
  or distinct specialist capabilities that the accepted plan needs.
- Reuse an agent that already owns the context instead of opening another wave.
- Worker agents do not spawn nested agents. The controller integrates results
  and owns plan-state changes.
- Repository search, report restatement, status checking, or confidence alone
  never justifies an additional agent.

Feature count, file count, domain count, task duration, and idle concurrency may
help select the original workflow mode; they do not independently authorize
extra agents beyond that workflow.

## Replan authority

The controller does not replan autonomously. Replan only after:

1. a direct user instruction; or
2. one evidence-backed finding from the appropriate authority: Advisor for
   outcome/scope ambiguity, Kongming for architecture or sequencing, Wukong for
   a falsifiable load-bearing claim, or a domain specialist for its constraint.

Apply the smallest affected plan delta and resume from the first affected
incomplete step. Ask the user before changing scope, non-goals, public
contracts, release target, risk acceptance, authority, or an irreversible
decision. Advice is not blanket permission to redesign the project.

## Verification and repair budget

Preserve every focused check, required tester/debugger step, independent review,
and final gate from the original workflow.

- During implementation, run the original focused safety checks. Reserve full
  lint/build/test/integration/browser/security suites for their named phase or
  terminal checkpoints.
- Do not rerun an unchanged passing gate or broaden a gate because of generic
  doubt.
- Rerun only the gate that covers a relevant repair, then resume the plan.
- At one failing checkpoint, allow two focused cause-aligned repair attempts
  plus at most one specialist-guided attempt.
- If the same gate still fails, preserve the evidence and report the blocker or
  ask the user. Do not enter an unlimited fix-test-debug cycle, weaken the test
  oracle, or restart the plan from zero.

Non-blocking improvements, polish, unrelated cleanup, and findings in untouched
code go to the plan's deferred queue unless they invalidate a load-bearing
assumption or make the accepted outcome unsafe.

## Completion

Continue through the original workflow until all in-scope exit criteria and
required gates pass, or until a concrete blocker requires user or external
authority. A partial implementation, intermediate compile, or agent report is
not a new planning checkpoint and not a completion claim.

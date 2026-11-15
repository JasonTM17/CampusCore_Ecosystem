---
name: ak:eval
description: "Evaluate AI/RAG/agent behavior with versioned cases, baseline/candidate outputs, grading, latency/token cost and explicit provider evidence limits. Use when model quality or tool authority is an acceptance claim."
user-invocable: true
argument-hint: "[dataset and baseline/candidate or workflow slug]"
metadata:
  author: agentkit
  version: "1.0.0"
---

# Evaluation

Use for AI/RAG/agent quality or agent tool-effect claims. Define task, dataset
revision, oracle/rubric, baseline and candidate snapshot, tool permissions,
environment and budget before running. For non-AI business behavior, use the
same evidence contract but do not claim model performance.

The shipped [twelve workflow recipes](fixtures/workflows.json) are isolated
**synthetic simulations**. Run `node scripts/run-workflows.cjs --json` from this
skill directory to inspect success, denied authority, failure/recovery and
contention/interruption cases. The runner returns case IDs, timing and
`providerStatus: NOT_RUN`. These fixtures prove only the example state machines.

For a real AI comparison, load [evaluation protocol](references/evaluation-protocol.md).
An ai-evaluator owns the assigned evaluation slice when delegation is justified.
Capture actual model/tool outputs and provider receipts, not the agent's claim
that it succeeded. Keep production credentials and private prompts out of
committed fixtures and logs. Write only assigned evaluation paths; controller
owns product decisions and plan state.

Done: same cases/rubric/environment applied to baseline and candidate; case-level
quality, authority violations, duration and token/cost availability reported.
An unavailable provider is NOT_RUN or BLOCKED_CAPABILITY, not a simulated PASS.
Stop on missing dataset authority, unsafe tool effects, unreliable oracle or
unbounded budget and return the exact blocker to the controller.

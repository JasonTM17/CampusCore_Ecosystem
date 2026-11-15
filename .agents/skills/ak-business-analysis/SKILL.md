---
name: ak:business-analysis
description: "Turn source requirements into actors, business rules, use cases, decision tables, states and invariants with explicit authority and test traceability. Use for multi-role or stateful business behavior; Advisor owns outcome and scope decisions."
user-invocable: true
argument-hint: "[requirement sources or accepted plan]"
metadata:
  author: agentkit
  version: "1.0.0"
---

# Business Analysis

Use when rules, exceptions, permissions, monetary values or transitions determine
correctness. Skip this ceremony for mechanical edits without business behavior.

Inputs: accepted outcome, source documents/revisions, authorized decision owner,
actors and current implementation evidence. Read relevant source; assumptions
remain proposed until confirmed by that owner. Advisor owns intent/scope changes.

1. Extract rules with source IDs, conditions, effective dates and authority.
2. Map actors, permissions, use cases, state transitions and invariants. Include
   denied permission, exception approval, partial failure and competing actions.
3. Write a decision table; identify overlaps, missing combinations and conflicts.
4. Connect each rule to use cases, proposed changes and explicit test oracles via
   [the shared trace contract](../ak-common/references/business-traceability.md).
5. Return confirmed facts, unresolved decisions and a bounded planner handoff.

Write only the assigned spec/trace/report paths. Do not implement, change plan
status, authorize exceptions or spawn agents. A business-analyst may own this
slice when the project delegation gate passes. Completion requires trace
validation and all decisions required for implementation resolved; otherwise
return BLOCKED_CAPABILITY or a precise decision blocker to the controller.

Load [analysis template](references/analysis-template.md) for artifact shape.
The shared contract has checked examples in
`../ak-common/scripts/workflow-contract.test.cjs`; run them with
`node --test ../ak-common/scripts/workflow-contract.test.cjs` from this skill
directory. They prove contract validation, not product approval.

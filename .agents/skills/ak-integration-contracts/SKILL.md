---
name: ak:integration-contracts
description: "Specify versioned API and event contracts, compatibility, retry, idempotency, duplicates, ordering and reconciliation. Use at service or provider boundaries before backend, payment or database implementation."
user-invocable: true
argument-hint: "[integration boundary and accepted rules]"
metadata:
  author: agentkit
  version: "1.0.0"
---

# Integration Contracts

Inputs: confirmed business rules, producers/consumers, current schemas, access
boundaries, delivery guarantees and provider documentation at a known revision.

Specify the contract using [the template](references/contract-template.md). Trace
rule IDs through use cases, changes, tests and evidence using
[the shared contract](../ak-common/references/business-traceability.md).

Resolve idempotency scope and retention, payload mismatch, duplicate/out-of-order
delivery, retry limits/backoff, timeout ambiguity, reconciliation and compensation.
Define compatibility and migration consumers before a breaking schema change.
Never infer provider guarantees from a mock. Keep credentials out of artifacts.

Write only assigned contract/spec paths. Hand implementation to installed
`/ak:backend-development`, `/ak:payment-integration` or `/ak:databases` as relevant.
Ask the controller for data-integrity review when transaction/concurrency/recovery
invariants need independent checking; do not self-approve or spawn recursively.

Done: contract owners identified, rule authority confirmed, negative/replay tests
specified and trace validated. Missing provider guarantees or incompatible
consumer versions stop that boundary; return exact missing input and owner.

The template's refund example is illustrative. Contract validation examples
run via `node --test ../ak-common/scripts/workflow-contract.test.cjs` from this
skill directory. Provider execution remains a separate gate.

# Incident, observability and restore contract

Use for stateful services and public integrations. Define service symptoms,
correlation IDs, business invariant alerts, redacted logs, owner/on-call and
runbook entry before rollout. Instrument duplicate/retry counts, queue age,
reconciliation mismatch and failed authorization without leaking payloads.

An incident report records detection time, affected tenant/scope, last known
good snapshot, containment decision, data authority, recovery command and
verification result. Separate restore rehearsal from a real production restore.
Test a controlled partial failure, replay and reconciliation in an isolated
environment; restore requires an authorized operator, backup identity and
post-restore invariant checks. Missing backup/provider/runtime is NOT_RUN or
BLOCKED_CAPABILITY, never a green readiness claim.

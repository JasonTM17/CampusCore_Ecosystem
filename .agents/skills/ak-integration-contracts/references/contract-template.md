# Integration contract template

- Boundary ID, source rule IDs, producer, consumer, owner and schema version.
- Request/event fields, units, nullability, authentication and tenant scope.
- Success/error payloads; retryable vs permanent failure; timeout ambiguity.
- Idempotency key scope, retention, payload hash mismatch and replay response.
- Delivery ordering, dedup storage/transaction boundary, poison event handling.
- Compatibility matrix for old/new producer and consumer; rollout/rollback order.
- Reconciliation source of truth, checkpoint, compensation and operator authority.
- Test IDs: accepted request, denied tenant/role, duplicate, stale version,
  concurrent request, failure after commit before acknowledgement, recovery.

Example: the same refund key and amount replays the committed result; the same
key with a different amount is a conflict. Two refund keys may compete but their
combined amount must never exceed the captured payment. These are illustrative
rules until the product and provider contract confirm them.

# Stateful recovery investigation

Use when a failure spans transactions, duplicate messages, migrations, offline
sync or restart. Reconstruct a timeline from durable IDs and redacted events.
State expected invariant, first divergence, authoritative source and exact
fault point. Reproduce a deterministic retry/race schedule when possible.

Before repair, record affected state and safe rollback/reconciliation owner.
After repair, prove both nominal and resumed behavior with a scoped test and
separate simulation from live service or restore evidence. Do not mutate
production state merely to complete a diagnostic.

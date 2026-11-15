# Source and index design

Load this reference when ingestion, reindexing, deletion, replay, or index
cutover is in scope. Fill the [contract template](contract-template.md) with
the consuming project's actual sources and owners.

## Source authority

Record `tenant`, stable `sourceId`, authoritative locator, owner, allowed use,
privacy class, retention/deletion policy, `sourceRevision`, ACL revision and
last confirmed status. Distinguish a source of truth from its index copy. A
scrape, connector response or file upload does not by itself confer authority
to embed, retain or send content to a model. Check processing/location and
provider permissions before extracting content. Separate public, team and
private corpora; do not infer authorization from the query's text.

## Versioned ingest

Define a reproducible pipeline: discover -> authorize -> extract/normalize ->
redact or exclude per policy -> chunk -> embed -> stage -> validate -> publish.
Record parser, chunker and embedding model revisions. Give each chunk a stable
identity such as `(tenant, sourceId, sourceRevision, transformRevision,
ordinal, digest)`; a mutable in-memory object or display title is not an
identity. Keep source pointers and checksums so citations resolve to the exact
version. Restrict raw-content and vector retention according to the same
approved data policy.

Stage all chunks and a manifest before an atomic active-snapshot promotion.
Use idempotent jobs and a monotonic source revision/high-water or tombstone
check at promotion. A retry after a crash must not publish half an index,
duplicate effective chunks, or overwrite a newer delete/ACL change. The
project chooses storage/transaction primitives and proves them with a
deterministic crash/replay test; this skill does not assume one database.

## Freshness, deletion and rollback

Track source update time, ingestion completion, active index revision and lag.
Define the consumer-approved freshness threshold and what to do when it is
exceeded: abstain, serve a verified older version, or block, according to
source risk. Source deletion or revoked access must affect query-time authority
even before index rebuild finishes. Treat indexed ACL metadata as a coarse
prefilter until authoritative status is checked.

Cutover and rollback change the active snapshot, not current source authority.
Before promoting or rolling back, compare the candidate snapshot with the
current source high-water/tombstone ledger and test a source deleted after the
older snapshot. Never restore a snapshot that makes a deleted source visible.
Document how to rebuild and reconcile orphaned staged chunks and how to prove
the active pointer is coherent after interruption.

## Implementation handoff

Send schema and atomicity to `/ak:databases`; connector/retry/idempotency
contracts to `/ak:integration-contracts`; service-level orchestration to
`/ak:backend-development`. The controller records confirmed rule IDs and
checkpoint receipts. A synthetic index model is useful for finding a bad
schedule, but is not proof of transaction behavior in the chosen store.

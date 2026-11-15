# RAG operations and recovery

Load when a consuming product needs runtime monitoring, incident response,
index migration or release acceptance.

## Observability

Record redacted query/case ID, actor/tenant pseudonym, source and ACL revisions,
retrieval/index snapshot, permission decision, cited chunk IDs/digests,
abstention reason, index lag, provider/model/prompt revision, latency and
token/cost availability. Never log raw private documents, full prompts,
credentials or forbidden snippets into shared telemetry. Define retention and
access to diagnostic traces with the corpus owner.

Monitor denied-access rate, stale/deleted-source candidates, index lag,
ingestion retries/dead letters, missing citations, unsupported claims,
abstention, timeout, provider errors and cost. Choose thresholds from the
consumer's approved SLO and threat model; the kit supplies no universal
latency, recall or hallucination target.

## Incident and restore drills

- On a suspected leak, stop answering from affected sources, preserve
  restricted evidence, revoke provider/index access as authorized, identify
  source/ACL/index/model revisions and route to the security/data owner.
- On a bad ingest, hold the active snapshot, quarantine staged chunks and
  replay idempotently from an authorized revision. Verify tombstone high-water
  before any promotion or rollback.
- On index/provider outage, use the approved abstention or degraded search
  path. Do not invent support or silently switch to an unapproved corpus.
- For rollback, prove the older snapshot still respects **current** source
  deletion and ACL authority; run a deleted-source negative test. Reconcile
  orphaned stages and active pointer after interruption.

Use `/ak:devops` for incident/restore runbooks and `/ak:debug` for root-cause
investigation. A dry run records commands, snapshot IDs and observed outcomes.
Mark missing live store/provider execution `NOT_RUN` or `BLOCKED_CAPABILITY`.

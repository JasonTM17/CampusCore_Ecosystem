# Illustrative helpdesk Q&A contract

**Example only:** a fictional team wants answers from its internal helpdesk
pages. Nothing here grants a real corpus or confirms a real business rule.

- Proposed source owner: helpdesk content manager. Proposed source ID:
  `team-a/reset-guide`, revision `7`; source ACL revision `12` allows the
  requesting team member. Retention, provider permission and latency budget:
  **unconfirmed**, so no real indexing/provider call is authorized.
- Proposed pipeline: extract revision 7, split with `chunker-v1`, create
  `team-a/reset-guide@7#chunk-1` with a content digest, stage `snapshot-4`,
  validate manifest and current ACL/tombstone high-water, then promote.
- Authorized query: “How do I reset the helpdesk token?” Retrieval returns
  the approved chunk. The final answer cites that exact source revision and
  span after an authoritative ACL check at publication.
- Denied query: a user from `team-b` asks the same question. The index filter
  and authoritative source check return no snippet and no answer based on the
  private guide. A “document title exists” hint is also withheld.
- Race: pause after generation, change source ACL to revision 13 to remove the
  user, then resume. The buffered answer is denied with zero emitted content.
- Ingest failure: stage half of source revision 8, crash, tombstone revision 9,
  then replay revision 8. No partial or resurrected guide becomes active.

The expected observations above are **test oracles**, not executed results.
The consuming product must confirm authority, implement its store/provider
boundary and record actual receipts before marking any case PASS.

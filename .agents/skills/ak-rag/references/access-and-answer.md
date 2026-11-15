# Access and answer boundary

Load this reference when retrieval, model context, citation rendering, tool
use or response publication changes.

## Three authorization points

1. **Query/retrieval:** derive principal and tenant from trusted server-side
   identity, then apply tenant and document ACL filters before ranking or
   returning snippets. A higher search score never overrides an ACL.
2. **Context assembly:** for each candidate, check current authoritative
   source existence, revision, ACL and deletion status before text is sent to
   any model/provider. Reject a source whose indexed metadata is stale,
   mismatched or unresolvable.
3. **Publication:** after generation and before emitting an answer, recheck
   current authority for each cited/supporting source and verify source/chunk
   revision, digest and span. Deny or regenerate on revocation or mutation;
   do not leak cached answer text during a failure.

Define the linearization point for final answer publication. A deterministic
test should pause immediately before emission, revoke a source, resume, and
assert zero output. For streaming, choose an approved per-chunk recheck and
cancellation policy, with an explicit residual risk for bytes already sent.
The conservative option for sensitive content is to buffer until the final
check. An authorization service outage fails closed for private content.

## Treat retrieved content as data

Documents, web pages and search snippets may contain hostile instructions.
Keep their role below system/developer policy. Do not let them change goals,
permissions, tool calls, recipients or citations; never forward credentials or
unrelated private data. Test instructions embedded in a high-ranked source,
including a request to exfiltrate or cite a different document. RAG retrieval
does not itself neutralize prompt injection; see
[OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/).

If the RAG answer can trigger tools, isolate the answer from tool authority and
use `/ak:security` plus the agent tool-effect recipe in `/ak:eval`.

## Grounding and citations

Require each answer claim that depends on corpus facts to map to an authorized
retrieved chunk and exact source revision/span. Preserve an immutable citation
record; re-resolve at publication and in any later audit. A plausible URL or
document title is not evidence. Unsupported claims, forged citations, empty
support and access mismatch should produce an approved abstention/error rather
than a confident answer. Separate a public answer from internal trace details
that might reveal forbidden source existence.

Provider-specific search filtering varies. For one example of document ACL
metadata and query-time enforcement, see [Microsoft's document-level access
control documentation](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview).
Verify the chosen provider's actual behavior before claiming equivalence.

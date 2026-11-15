# Evaluation protocol

1. Freeze dataset ID/revision, consent/authority, cases, expected observations,
   rubric and grader before running either version. Include normal, denial,
   ambiguous, malicious and recovery cases where risk requires them.
2. Freeze baseline and candidate source/model/provider/tool configuration,
   prompt revision, retrieval corpus, permissions, seed (when meaningful) and
   cost budget. Record differences explicitly.
3. Execute each case; capture raw output in a restricted artifact location,
   grade against the same oracle, and record failure categories. Redact secrets
   and sensitive input in shared receipts; retain a private secure pointer when
   raw data is necessary for audit.
4. Report pass numerator/denominator, authority/safety failures, per-case time,
   aggregate time, observed tokens/cost or `NOT_RUN` when unavailable. Compare
   distributions and traces, not only an overall score.
5. Re-run only when a relevant input changes. An offline simulation or static
   contract result cannot qualify an authenticated provider, a browser, a live
   database or production effects.

Use an independent grader or deterministic oracle where feasible. If an LLM
grades results, test order sensitivity and disagreement; do not let the same
agent self-grade its own tool actions. Preserve a failing case in the dataset.

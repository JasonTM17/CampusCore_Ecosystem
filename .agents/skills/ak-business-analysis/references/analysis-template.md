# Analysis template

Record outcome/non-goals and source locator, revision, authority, effective date.
For each rule: ID, statement, source IDs, confirmed/proposed/disputed, confirmedBy.

| Rule | Actor | State before | Condition | Allowed transition | Denial | Recovery |
|---|---|---|---|---|---|---|
| BR-1 | approver | submitted | matching tenant and level | approved | unchanged | retry with same request ID |

Illustration only: approver cannot approve their own request; source and approver
policy must be confirmed in the consuming project before implementing this rule.

List invariants, conflicting rules, unanswered questions and receiving owner.
Write version-1 trace JSON from the shared contract. Include success, denial,
recovery and race/interruption cases; use explicit expected state, not 'works'.

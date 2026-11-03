# Thesis result disposition

A thesis round may publish a terminal non-numeric outcome for a topic whose
assigned counter-reviewer (GVPB) scored it below the 5.0 defense threshold.
The outcome is `NOT_QUALIFIED`. It means **ineligible for defense because the
counter-review score is below 5.0**; it is not a failing defense score and it
carries no number. Publication never invents a `0` or `4.9`.

## States

`result_status` is topic-level. Existing topic scores, comments and audit rows
stay as historical evidence.

| `result_status` | `final_score` | `result_reason` | Meaning |
|---|---|---|---|
| `NULL` | `NULL` | `NULL` | Unresolved. Blocks publication while an approved group needs it. |
| `GRADED` | `0.00`–`10.00` | `NULL` | Numeric defense result finalized by the council chair. |
| `NOT_QUALIFIED` | `NULL` | `GVPB_BELOW_THRESHOLD` | Ineligible for defense because the counter-review score is below 5.0. |

A `NOT_QUALIFIED` row also stores `result_resolved_by` (the authorized
publisher) and `result_resolved_at`; the resolver identity is staff/audit-only
and is never exposed to students. `final_score_finalized_by` and `final_score_finalized_at`
stay `NULL`, so an unresolved numeric finalization cannot masquerade as a
disposition. Migration
[V152](../../java-services/restful-api/src/main/resources/db/migration/V152__thesis_result_disposition.sql)
adds `result_reason`, `result_resolved_by` and `result_resolved_at` on the
existing `result_status` column, plus the `thesis_topic_result_shape_valid`
check, which rejects every other combination (the `CASE ... ELSE FALSE END`
form prevents a SQL `NULL` from bypassing the check). The
[H2 twin](../../java-services/restful-api/src/test/resources/db/migration-h2/V152__thesis_result_disposition.sql)
keeps the test chain aligned. V152 backfills only existing numeric results as
`GRADED`, copying provenance that already exists; it does not classify
below-threshold rows.

## When classification happens

Classification runs atomically inside
`POST /api/v1/thesis/rounds/{id}/publish-results`, under the existing round
lock, after the round is confirmed `REGISTRATION_CLOSED` and using server time.
It applies only to `TLCN` and `KLTN` rounds whose `gvpb_deadline` is non-null
and closed (server time is at or after the deadline, the boundary already used
by the counter-review window). Every other round type is untouched.

Before the deadline closes a low review stays unresolved: publication returns
the same `409` as today (`RESULTS_NOT_READY` when no group is resolved,
`SCORES_INCOMPLETE` when an approved group is unresolved). A low review never
becomes an early permanent failure. A nonempty round may publish with no
numeric grade at all when every approved group is resolved. The outcome is
recorded on the topic, so every approved group sharing that topic inherits it.

The publisher is the existing authorized role set:
`ADMIN`, `TRUONG_KHOA` or `SUPER_ADMIN`. The publish request and response are
unchanged. Pending submitted groups still block with `GROUPS_PENDING_APPROVAL`;
a wrong round state still returns `ROUND_STATE_CONFLICT`.

## Evidence rule

The only accepted evidence is a canonical counter-review row in
`thesis.thesis_topic_score`:

- `component = 'GVPB'`
- `council_id IS NULL`
- `lecturer_id = thesis_topic.gvpb_lecturer_id`
- the stored `score` is less than `5.00`

A missing row, a score recorded by a different lecturer, a council-scored row,
conflicting or duplicate rows, or a stored score of `5.00` or more leaves the
topic unresolved and blocks publication as today. The threshold compares the
stored value; the classifier does not re-round it.

Chair finalization keeps its current rules: `POST
/api/v1/thesis/councils/{councilId}/topics/{topicId}/finalize` still rejects a
below-threshold counter-review with `409 REVIEW_SCORE_BELOW_THRESHOLD`.
Qualifying topics are finalized normally before publication.

## API fields

All additions are additive: the new fields are response-only, no new request
input is required, and no field or route is removed or renamed.

- Topic responses (`TopicResponse` on `GET /api/v1/thesis/topics` and
  `GET /api/v1/thesis/topics/{id}`) keep `resultStatus` and add
  `resultReason` (`string | null`) and `resultResolvedAt` (ISO instant or
  `null`). All three are masked together with `finalScore` before publication
  and for unrelated users; `gvpbLecturerId` masking is unchanged.
- Personal results (`GET /api/v1/thesis/me/results?roundId=...`,
  `StudentResultRow`) gain `resultStatus`, `resultReason` and
  `resultResolvedAt`; `finalScore` becomes `number | null`.
- Progress (`GET /api/v1/thesis/me/progress?roundId=...`, `ProgressResponse`)
  appends `resultStatus`, `resultReason`, `resultResolvedAt` and
  `skippedMilestones` (`string[]`). For a published `NOT_QUALIFIED` result:
  `attentionState = "NOT_QUALIFIED"`, `currentMilestone = "RESULTS_PUBLISHED"`,
  `completedMilestones` contains the reached milestones plus
  `RESULTS_PUBLISHED`, `skippedMilestones` is the two-element list
  `["COUNCIL_ASSIGNED", "SCORE_FINALIZED"]`, and `finalScore` and
  `finalScoreFinalizedAt` are `null`. The response must never use
  `RESULT_NOT_AVAILABLE` or `PROGRESS_INCONSISTENT` for this outcome. Graded
  results keep today's shape with `skippedMilestones = []`.

The frontend `ThesisRoundResult.finalScore` becomes `number | null` (the
progress type already allows null); a null score must never render as `0`,
`NaN`, or an empty score tile.

## Student meaning

The student sees one explicit outcome, in Vietnamese and English:

- `Không đủ điều kiện bảo vệ - điểm phản biện dưới 5,0`
- `Not eligible for defense - counter-review score below 5.0`

There is no score label, classification or green completion styling. Skipped
milestones read `Không áp dụng` / `Not applicable`. Applicable published
evaluation comments remain visible. The disposition is disclosed only after
publication and only to an approved member of the group; prepublication and
unrelated-user restrictions are unchanged.

## Notifications

Publication still sends the inbox notification and the email after commit, to
every approved, non-cancelled group member, including members of a
`NOT_QUALIFIED` topic. The publish message is neutral ("view your result"): it
contains no numerical score and no adverse disposition; numerical results stay
behind authenticated lookup. Publication does not call `notifyScoreFinalized`
for a `NOT_QUALIFIED` topic, because that message claims a defense score was
finalized.

Deterministic notification ids, retry deduplication and legacy-message
compatibility are preserved. `POST
/api/v1/thesis/rounds/{id}/publish-results/notifications/retry`
(`ADMIN`/`SUPER_ADMIN`) re-sends the inbox fan-out without creating
duplicates. Delivery remains best-effort: there is no outbox and a process
failure can lose a message.

## Operator guidance

Before publishing:

1. Close registration and approve or reject every submitted group; pending
   approval blocks publication.
2. Confirm the round type is `TLCN`/`KLTN` and the GVPB deadline is closed
   (server time at or after `gvpb_deadline`).
3. Confirm the assigned reviewer recorded the counter-review before the
   deadline. A missing or mismatched review cannot be repaired by publication;
   the round stays blocked.
4. Finalize every qualifying topic as usual. Below-threshold topics need no
   chair finalization.

After publishing, verify with a read-only query:

```sql
SELECT id, result_status, result_reason, final_score,
       result_resolved_by, result_resolved_at
FROM thesis.thesis_topic
WHERE round_id = '<round-id>';
```

Do not set `final_score` to `0`, insert a synthetic score, or edit
`result_status`/`result_reason` directly to force a round through. If the
evidence is wrong, correct it through the reviewer/finalization flow before
publication; after publication, treat it as a forward fix (below).

## Rollback and forward fix

The schema change is additive. An application rollback before any
`NOT_QUALIFIED` row exists can retain V152; older code keeps writing `GRADED`
numeric results and the check remains valid. After dispositions exist, keep
readers that understand them and forward-fix: never drop the columns or the
shape check to hide a disposition, never rewrite an applied Flyway
migration, and never run `clean` or edit checksums. A destructive schema
downgrade that would erase dispositions is refused.

## Explicitly not done

- No appeal, correction or reopen of a `NOT_QUALIFIED` result.
- No gradebook, GPA or `F` grade side effect; the academic record is untouched.
- No numeric final score is created, and `finalScoreFinalizedAt` stays `NULL`.
- No `notifyScoreFinalized` message for an automatic non-qualification.
- No reclassification or reinterpretation of already published results.
- No new route and no publish request/response change.

## Executable owners

- [Publication and classification](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/service/ThesisMutationService.java):
  `publishResults`, `sendPublishedResults`.
- [Finalization and student results](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/service/ThesisCouncilService.java):
  `finalizeScores`, `studentResults`.
- [Progress](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/service/ThesisProgressService.java):
  `get`.
- [Topic masking](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/service/ThesisTopicService.java):
  `maskScoreIfNeeded`.
- [Notifications](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/service/ThesisNotificationService.java):
  `notifyResultsPublished`, `emailResultsPublished`.
- [DTOs](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/web/ThesisTopicDtos.java),
  [progress DTO](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/web/ThesisProgressDtos.java).

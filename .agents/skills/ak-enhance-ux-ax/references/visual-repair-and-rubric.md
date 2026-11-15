# Visual repair and internal rubric v1

Evaluate visible results and tasks, then explain causes. Keep approved brand,
stack and facts. New interfaces choose a deliberate audience-appropriate
direction; existing interfaces get an explicit, in-scope design delta.

| Dimension | Questions | Observable repair |
| --- | --- | --- |
| Composition | One focal point? Intelligible sequence? | Rebalance columns, fold, sections and anchors around the task |
| Hierarchy | Offer, next action and status identifiable? | Establish heading/metadata/action order; remove competing emphasis |
| Typography | Readable measure, Vietnamese glyphs, coherent scale/weight? | Approved type tokens, line height, wrapping, tabular data |
| Color | Clear roles? Measured contrast? Color alone carries meaning? | Semantic tokens, restrained emphasis, text/icon cues, contrast checks |
| Spacing/density | Intentional rhythm, alignment, usable work density? | Consistent grid/gaps, task grouping; avoid oversized dashboard cards |
| Imagery/icons | Relevant, truthful, useful, consistent? | Approved assets, stable icons, alt semantics, predictable loading |
| Components | Consistent variants, borders, actions and state language? | Reuse tokens/components; labelled enabled/disabled/pending states |
| Motion/feedback | Clarifies? Exposes actual outcome? | Bounded transitions, reduced motion, stable loading, useful error/retry/success |

## Design delta

Each repair group records:

1. Observed issue with frame/task ID; source-only suspicion stays unverified.
2. Evidence-supported cause; distinguish hypothesis.
3. Direction and fit to audience/brand/task.
4. Exact owned files and protected invariants.
5. Expected visible/task change and falsifiable acceptance.
6. Checks and matched first/full-page/component captures.

Example: booking options compete with the action and overflow at 375. Cause:
fixed four-column grid and mixed button semantics. Direction: stack labelled
options, preserve transparent pricing and stable request action. Retain options,
totals, keyboard selection and retry. Check selection/invalid/success,
375/768/1440 frames and 320 reflow. Do not claim conversion increased.

## Score with evidence; never trade critical gates

Internal ordinal 0–4 per dimension: 0 task-blocking/absent, 1 major problems,
2 workable with weaknesses, 3 coherent/usable, 4 strong for the agreed brief.
Record rationale/observer; do not score unobserved dimensions.

Default internal UX weights: visual craft 35%, message/task 20%, responsive 15%,
states/recovery 10%, accessibility 10%, trust 5%, performance 5%. Declare profile
adjustments before sampling, never change weights to improve results. Missing
coverage stays separate; do not normalize unknown evidence into a high score.
AX is applicable pass/fail/unrun checks, separate from UX.

Must/access/privacy failure, broken earlier PASS or missing required browser/
vision veto acceptance regardless of score. This score is a review aid, not a
validated user-preference, business or search metric.

## Matched image review

Capture initial and accepted source versions separately. Match route/role/state,
viewport/device scale/theme/fixture/browser/platform/fonts. Source hashes may
differ; bind each image to its actual version. Wait for assets/fonts, control
time/animation without hiding loading/layout problems. Use public synthetic
fixtures and redact real data before sharing; restrict original raw evidence.

First viewport: message/focal point/CTA. Full page: rhythm/repetition/sections.
Component/state: wrapping, errors, focus, feedback, density. Record gains and
new defects. Screenshots cannot prove keyboard/backend/role enforcement;
exercise tasks separately. DOM assertions cannot prove attractive composition.

Independent vision, when available, receives actual images and brief rather
than only the author's conclusion. Record observer/frame digests/issues/status.
Missing actual observation is BLOCKED_CAPABILITY; submitted observer strings
or validator PASS do not prove review.

## Stable rounds and evaluation

Keep direction/baseline fixed. Carry PASS only for unchanged scope; rerun
impacted tasks/captures. Reject oscillation, speculative Could and rounds with
no named gain. Preserve rejected evidence. Reverse only owned current
postimages; do not regenerate goldens, weaken thresholds or delete IDs.

Paired baseline = same matching existing FE workflow; candidate adds this
coordinator. Freeze task/facts/source/model/runtime/budget/order/context,
held-out partition and rubric before execution. Keep every outcome; blind
independent scoring; disclose reused context, neutral/failing cases and unknown
token/timing metrics. Task-decision output supports decision quality; real UI
improvement still requires executed browser/vision proof.

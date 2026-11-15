# Surface profiles and task coverage

Select profiles per route; mixed products can have several. Public/private
classification comes from owner policy, not a model deciding content should
be discoverable. Record the actual stack/brand and critical task first.

| Profile | Visual direction and task | State evidence | AX applicability |
| --- | --- | --- | --- |
| Landing/brand | Clear offer/audience/value in first viewport; one primary task; deliberate type, rhythm and proof | Nav/mobile menu, CTA destination, long copy, focus, empty assets | Public response text, title/description, canonical, social preview, factual schema |
| Commerce/booking | Legible price/options/conditions, comparison and next step; total/availability truthful | Selection, invalid/loading, preserved input, confirmation; no unauthorized real purchase | Public product/service details, truthful eligible schema; private checkout excluded |
| Content/docs | Reading hierarchy, readable measure, anchors/search, meaningful attribution/date | Long Vietnamese text, headings/code/table overflow, search empty/error | Public links/HTML, canonical/sitemap, metadata; optional public Markdown/llms |
| Dashboard/admin | Scan hierarchy, task-appropriate density, consistent data/actions/status, table strategy | Loading/empty/error, filters/reset, stale data, allowed/denied roles | Semantic tasks/name/state; protected private data/exports; public SEO usually N/A |
| Forms/workflow | Label → input → help/error; clear steps/requirements, stable actions and feedback | Invalid/submitting/success/retry, duplicate submission, preservation, keyboard/focus | Semantics and observable outcomes; authorization unchanged; private data never indexed |

## Freeze the brief

```text
Audience / primary task / success signal:
Route or view / public-private / role / state:
Source root / owned paths / stack / start and test commands:
Approved brand / tokens / assets / claims / design direction:
Locale / content-length / fixture / theme / fonts:
Protected task and check IDs / applicability with reasons:
Mode / maximum rounds / verification budget / output root:
Unresolved facts / decisions / tool limits:
```

Do not invent metrics, testimonials, certification, availability or policies.
Synthetic evaluation fixtures must say demo. A proposed message can improve
clarity without manufacturing commercial proof.

## Responsive task matrix

Start at 375/768/1440 CSS px; add targeted 320 reflow and actual project
breakpoints. Samples are not all-device coverage. Check 200% zoom and text
scaling where supported. Font/rendering environment belongs in frame identity.

- Recompose: reorder secondary detail, wrap sensibly, use readable measure,
  task-relevant density, nav/disclosure/table strategy; do not shrink desktop.
- Long Vietnamese labels, accents, names, URLs, numbers, zero/empty data must
  wrap without obscuring actions or causing page-wide overflow.
- Tables may use a constrained horizontal region with visible affordance and
  accessible headings; do not hide essential columns silently.
- Sticky headers/actions must not cover content, focused controls or messages.
- Hover cannot be the only path. Touch size/spacing need actual checks;
  WCAG 2.2 AA target-size rule has exceptions, not an unconditional 44px claim.
- Menus/dialogs: reachable labelled controls, expanded/state semantics, focus
  trap where appropriate, Escape, return focus, inert background.
- Exercise invalid/loading/empty/error-retry/success for critical actions;
  preserve input and clear pending/duplicate behavior. Honor reduced motion.

## Routing constraints

Use frontend-design composition advice and applicable UI/UX pro max choices
without replacing current stack/brand. UI styling applies to its supported
CSS/component stack; React/Next helpers apply only there. A web audit must not
migrate to React Native because a helper contains mobile guidelines. Existing
design-system accessibility and business rules remain protected.

Use web-testing for real tasks; keep missing axe/screen-reader/field tooling
visible. Selectors and keyboard walkthroughs are not full WCAG conformance.
Real auth/security needs its own workflow.

## Smallest coherent change

Group by cause: typography/hierarchy, navigation/task flow, component-state
feedback, public metadata. Hold direction stable between rounds and preserve
previous successes. Defer unrelated polish, migrations, production policy and
extra provider/agent features.

# Archify engine

[Archify](https://github.com/tt-a1i/archify) (tt-a1i, Apache-2.0) turns
typed JSON into one checked, standalone, interactive HTML diagram. The agent
writes the JSON; Archify's renderer owns layout and output. AgentKit does
not vendor it: the installed Archify `SKILL.md` is the authority for
schemas, authoring defaults and repairs. Load it completely before writing
a candidate. This file covers how `ak:diagram` drives it. Written against
Archify 3.2.0; the wrapper refuses anything older.

## Contents

- [Install (with consent only)](#install-with-consent-only)
- [Types](#types)
- [Commands](#commands)
- [Files and placement](#files-and-placement)
- [Receipts and failures](#receipts-and-failures)
- [Mermaid input](#mermaid-input)
- [Privacy and network](#privacy-and-network)

## Install (with consent only)

`DIAG doctor` reports `archify.status`. When it is `NOT_INSTALLED`, ask the
user two things, then run only these commands:

1. Scope: this project only, or global for the user.
2. Target agent(s): the current runtime unless the user names others
   (`claude-code`, `codex`, `cursor`, `opencode`, `github-copilot`).

```bash
npx -y skills@latest add https://archify.si --list --full-depth
npx -y skills@latest add https://archify.si --skill archify --agent claude-code --copy --yes
```

Stop if the listing does not show exactly one skill named `archify`. Add
`--global` only for a confirmed global install. If the installer reports a
conflict with existing files, stop and tell the user; never delete them.
Verify with `DIAG doctor --deep`. Never update Archify on your own; an
update notice in a receipt is passed on to the user once.

The wrapper looks for `bin/archify.mjs` under `ARCHIFY_HOME`, then the
project's `.claude/`, `.agents/`, `.codex/`, `.cursor/`, `.opencode/`
`skills/archify`, then the same folders in the user's home
(`~/.config/opencode/skills/archify` for OpenCode).

## Types

| Type | Use for |
| --- | --- |
| `architecture` | components, services, storage, trust boundaries |
| `workflow` | CI/CD, approvals, tool calls, runbooks |
| `sequence` | API call chains, cache fallback, auth, async traces |
| `dataflow` | pipelines, ETL/ELT, lineage, PII movement |
| `lifecycle` | states, retries, waits, terminal outcomes |
| `erd` | tables, every column with type, keys, cardinality |
| `class` | classes, interfaces, selected members, relationships |
| `tree` | single-parent hierarchies: repo/module trees, capability breakdowns |
| `timeline` | timestamped events: incidents, release history |
| `waterfall` | span durations and nesting of one request or agent run |

Unsure between two: `DIAG archify -- guide "<scenario>" --json`.

## Commands

Every Archify call goes through the wrapper so resolution, version check
and the `BLOCKED` contract stay uniform. Arguments after `--` are passed
unchanged; exit code and output are Archify's own.

```bash
DIAG archify -- finalize <type> <candidate.json> <out.html> --quality showcase --json
DIAG archify -- finalize architecture <candidate.json> <out.html> --repo-root . --quality showcase --json
DIAG archify -- finalize <type> <candidate.json> <out.html> --quality showcase --out-dir <folder>/review-2 --json
DIAG archify -- validate <type> <candidate.json> --quality showcase --json
DIAG archify -- compare architecture base.json head.json delta.html --json
DIAG archify -- visual-check <out.html> --summary --require-provenance --out-dir <folder>/visual-check
DIAG archify -- guide "<scenario>" --json
DIAG archify -- doctor
```

Archify exits `0` on success, `1` for renderer and artifact failures, `2`
for usage errors; `browser-check`/`visual-check` use `2` for "skipped, no
supported browser". Treat every non-zero exit as not passed, including `2`
from a skipped browser gate.

- `finalize` is the normal path for a first candidate and after each repair:
  validate → deliver → strict check → real-browser check, stopping at the
  first failure.
- `--quality` matches `meta.quality_profile` (`showcase` by default,
  `standard` for a dense first ERD pass).
- `--repo-root` keeps source markers checkable for repository-backed
  diagrams; include source evidence in the first draft.
- Once a run reached the browser check, later runs on the same output need
  their own `--out-dir <folder>/review-<n>`.
- `preview` starts a loopback watch server; use it only when the user asks
  for a live loop, and stop it when done.

## Files and placement

For repository docs, keep the editable source with its output:

```text
docs/diagrams/<slug>/
  <slug>.<type>.json          candidate (commit this)
  <slug>.html                 delivered diagram (commit this)
  <slug>.delivery.json        delivery receipt (evidence)
  <slug>.finalize-summary.json, <slug>.finalize.json,
  <slug>.browser-check.json   gate receipts (evidence)
```

Receipts are bound to the exact HTML bytes; they go stale the moment the
HTML changes. Keep them out of commits unless the project wants evidence in
the repository. Set `meta.output` in the candidate to the same POSIX-style
relative path (`docs/diagrams/<slug>/<slug>.html`): forward slashes, inside
the working directory, ending in `.html`.

`DIAG paths "<topic>" --engine archify --type <type>` prints those paths.
For a one-off diagram outside the docs, Archify's own default folder
`.archify/<type>-<slug>-<timestamp>/` is fine.

In the doc page, link the HTML with a descriptive title and keep a small
Mermaid overview of the same main path so the page reads on GitHub, where
an HTML file is not rendered inline.

## Receipts and failures

- Exit `0` with a passing receipt: report "automated checks passed" and
  whether a visual review happened.
- Non-zero: read the compact stdout or `evidence.summaryReceipt`; apply only
  each diagnostic's `supportedFixes`; edit the affected neighbourhood of the
  JSON; rerun the same `finalize`. Two repair rounds, then report what
  remains.
- `visualReviewRecommendation` and `layoutReviewRecommendation` are advisory;
  follow the installed Archify `SKILL.md` for them.
- `update.noticeRequired: true` → one short update notice in the final reply.

## Browser and static images

- The browser gate needs Chrome, Chromium or Edge. `ARCHIFY_CHROME` points
  at a specific executable; an invalid value fails instead of falling back.
  No browser → the gate is skipped (exit 2), which is not a pass.
- On Windows, run from a normal (non-elevated) shell if the browser loses
  its DevTools pipe; never disable the browser sandbox to get past it.
- Archify 3.2.0 has no CLI command for SVG/PNG export. Static images come
  from the delivered HTML's Export menu (key `E`: SVG, light/dark SVG, PNG).
  When a static image must be produced unattended, route to tech-graph or
  commit a Mermaid block instead.
- `visual-check` writes four viewport PNGs and a contact sheet for review;
  captures are evidence to look at, not a passed visual review.

## Mermaid input

Archify reads Mermaid for meaning, not style; author fresh JSON:
`flowchart` → `workflow` or `architecture`, `sequenceDiagram` → `sequence`,
`stateDiagram` → `lifecycle`, `erDiagram` → `erd`, `classDiagram` → `class`.
Use this to upgrade an existing docs diagram that outgrew Mermaid.

## Privacy and network

- Rendering is local. The delivered HTML embeds its scripts, styles and
  fonts; it loads nothing remote (source links navigate out only when
  clicked).
- Archify may fetch a fixed release manifest to show an update reminder; it
  sends no project data and never installs anything. Set
  `ARCHIFY_UPDATE_CHECK_DISABLED=1` to turn that off (the wrapper does this
  for `doctor --deep`).
- Hosted sharing is out of Archify's scope; do not upload diagrams anywhere
  without the user's approval.

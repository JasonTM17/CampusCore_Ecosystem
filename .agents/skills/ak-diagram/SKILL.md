---
name: ak:diagram
description: "Pick the right engine for a technical diagram and deliver it checked: inline Mermaid for README and docs, Archify for repository-backed or interactive HTML diagrams, ak:tech-graph for styled static images. Routes, gathers evidence, lints and renders Mermaid, runs Archify finalize, and audits a docs tree's diagrams. Use for architecture, flow, sequence, ERD, state, timeline and waterfall diagrams and for documentation diagram passes."
user-invocable: true
when_to_use: "Invoke when a request asks to draw, diagram or visualize a system, flow, schema, state machine, history or timing, when docs need diagrams added or fixed, or when diagrams in Markdown must be validated."
category: dev-tools
keywords: [diagram, mermaid, archify, tech-graph, architecture, flowchart, sequence, erd, docs, validation]
argument-hint: "<description> | --repo [scope] | --docs [dir] | --check [path] | --pr [base] | --engine mermaid|archify|tech-graph | --doctor"
metadata:
  author: agentkit
  version: "1.0.0"
---

# Diagram

One entry point for diagrams. This skill decides **which engine**, collects
**the facts** the diagram shows, and runs **the gate** that proves the
output renders. The engines own syntax, layout and styling:

| Engine | Output | Delegate to | Default for |
| --- | --- | --- | --- |
| Mermaid | text block inside Markdown, renders on GitHub | `/ak:mermaidjs-v11` for syntax | README, docs, ADRs, PR descriptions |
| Archify | one interactive standalone HTML from typed JSON | the installed `archify` skill | code-backed architecture, large or interactive diagrams, ERD with every column, timeline, waterfall, PR architecture delta |
| tech-graph | SVG (+ PNG) in one of 7 visual styles | `/ak:tech-graph` | a styled static image for a slide, blog or README hero |

Never hand-write SVG for a diagram. tech-graph output is produced by its
JSON template generator through this skill's wrapper, not typed by hand.

All commands run from the project root. `DIAG` means `node` plus
`scripts/ak-diagram.cjs` next to this `SKILL.md` in the registry you loaded
it from, for example in Claude Code:

```bash
node .claude/skills/ak-diagram/scripts/ak-diagram.cjs
```

Each wrapper command prints one JSON object and never prompts. Exit codes:
`0` ok, `1` diagram error (fix and retry), `2` usage error, `3` BLOCKED.

## Modes

| Argument | What happens | Reference |
| --- | --- | --- |
| `<description>` | one diagram, engine chosen by `DIAG route` | this file |
| `--repo [scope]` | diagram of real code, every node and edge backed by a file | `references/workflow.md` |
| `--docs [dir]` | inventory, fix and add diagrams across a docs tree | `references/workflow.md` |
| `--check [path]` | read-only lint and render check of every Mermaid block | `references/workflow.md` |
| `--pr [base]` | Archify architecture delta between base and head | `references/workflow.md` |
| `--engine <name>` | skip routing; use that engine | this file |
| `--doctor` | report engine readiness only | Step 0 |

With no argument, infer the mode from the conversation (a doc being edited
→ `--docs` for that file; a finished change touching architecture → offer
`--pr`). If nothing fits, ask once what to draw.

## Step 0 — Doctor (once per session)

```bash
DIAG doctor
```

It never installs or downloads. Read `engines`:

- `mermaid.runner` `npx-cache`, `global` or `env` means the renderer is
  local. `npx` means it is not installed: `render` then returns `BLOCKED`
  until the user agrees to download the pinned `@mermaid-js/mermaid-cli`
  from npm, after which you pass `--allow-download` once. `lint` needs no
  renderer. A system Chrome/Edge is used when found.
- `AK_DIAGRAM_MMDC_BIN` runs a specific mermaid-cli; `render` reports
  `version` and `pinMatched`, so say which version rendered when it is not
  the pin.
- `archify.status` `NOT_INSTALLED` lists the paths searched and the install
  commands. Archify is third-party (Apache-2.0); install it **only after
  the user confirms scope** (global or this project) and target agent. Until
  then use the degraded path in Step 3.
- `techGraph.png` `NOT_AVAILABLE` means SVG only; PNG export is `NOT_RUN`
  until `rsvg-convert` (librsvg) is installed.

`DIAG doctor --deep` also runs Archify's own `doctor` with its update check
disabled; a failing health check makes doctor exit `1` with `status: FAIL`.
An Archify install whose version cannot be read, or is older than 3.2.0
(prereleases included), is `UNSUPPORTED` and the wrapper will not run it.

## Step 1 — Route

```bash
DIAG route "<the user's request>" [--target inline|interactive|image|repo] [--nodes <n>]
```

It returns `engine`, `type`, `target`, `reasons` and `alternatives`.
Follow it unless the user named an engine or an output. The rules it
applies, so you can explain the choice in one line:

1. Target first: docs/README/PR → `inline` (Mermaid); this repo/codebase →
   `repo` (Archify); interactive/share/explainer → `interactive` (Archify);
   slide/blog/PNG/named style → `image` (tech-graph).
2. Inline Mermaid is the default: GitHub renders it, it diffs as text and
   needs no build step.
3. More than ~20 nodes inline → Archify, linked from a small Mermaid overview.
4. Detail Mermaid cannot carry → Archify: an ERD with every column, or a
   PR/base-head architecture delta.
5. A kind an engine cannot draw faithfully moves to one that can
   (waterfall → Archify only; gantt and mind map → Mermaid only).

Load `references/engine-selection.md` when the user asks why, asks for a
tool this kit does not wrap (D2, PlantUML, Structurizr, draw.io …), or the
route looks wrong for the request.

## Step 2 — Collect the facts

**Never invent structure.** Every node, edge, label, number and timestamp
comes from the user's words, the repository, or tool output in this session.

- Described system: use the user's components and names; ask for a missing
  piece only when the diagram is wrong without it.
- Repository (`--repo`, or `target: repo`): run `/ak:scout` (or native
  search) over the named boundary first and note the file that proves each
  component and edge. Leave out what you cannot prove, or label it as an
  assumption in the diagram.
- Timings and timestamps: real only when they come from logs or traces;
  otherwise mark them illustrative.

## Step 3 — Author

Pick the output path with:

```bash
DIAG paths "<topic>" --engine mermaid|archify|tech-graph [--dir <dir>] [--type <archify type>]
```

Repository docs default to `docs/diagrams/`; a diagram for a plan goes in
`{plan_dir}/visuals/` via `--dir`. Inline Mermaid needs no path: it lives in
the Markdown it explains.

### Mermaid

Load `/ak:mermaidjs-v11` for syntax and `references/mermaid-docs-style.md`
for repository conventions (placement, size, `accTitle`/`accDescr`, no
theme or hard-coded colors, GitHub-safe types). Write the block in place.

### Archify

Load the installed Archify `SKILL.md` completely and follow it; this skill
does not restate its schemas. Run its CLI through the wrapper so resolution
and errors stay uniform:

```bash
DIAG archify -- finalize <type> <candidate.json> <out.html> --quality showcase --json
DIAG archify -- finalize architecture <candidate.json> <out.html> --repo-root . --quality showcase --json
```

Keep the candidate JSON beside the HTML in `docs/diagrams/<slug>/` so it can
be edited and re-finalized; in a doc page link the HTML and keep a small
Mermaid overview so the page still reads on GitHub.
Load `references/archify-engine.md` for commands, receipts, exports and
failure handling.

**Archify missing:** report `BLOCKED: archify not installed` with the
doctor's install line, ask whether to install it, and meanwhile deliver the
same nodes and edges as Mermaid, saying it is the degraded path. Never
install or update Archify on your own.

### tech-graph

Load `/ak:tech-graph` for its style references and layout rules, then write
the diagram as template data, not SVG:

```bash
DIAG tech-graph <template> <out.svg> <data.json> [--png]
```

Templates include `architecture`, `agent`, `memory`, `data-flow`,
`flowchart`, `sequence`, `state-machine`, `er-diagram`, `timeline`,
`use-case`, `comparison-matrix`; the full list is in
`references/tech-graph-engine.md` with the data shape. Store the data as
`<slug>.tech-graph.json` next to the SVG.

## Step 4 — Gate

| Engine | Command | Pass means |
| --- | --- | --- |
| Mermaid | `DIAG lint <files>` then `DIAG render <files> --check` | known type, safe content, parsed and rendered by the pinned mermaid-cli |
| Archify | the `finalize` receipt (`ok`, exit 0) | Archify's validate, deliver, check and browser-check gates |
| tech-graph | `DIAG tech-graph ...` `steps[]` | generator ran, SVG shape, XML-parsed allowlist of plain drawing markup (no scripts, handlers or external loads), rsvg parse when available |

- On `FAIL`, fix exactly what the result names (block and line, Archify
  `diagnostics[].supportedFixes`, generator error) and rerun the same gate.
  At most two repair rounds; then report the remaining errors.
- `NOT_RUN` (renderer download blocked, no rsvg) is not `PASS`. Say which
  gate did not run and why.
- `render` writes SVG/PNG only with `--out-dir`; `--check` leaves nothing.
  Output names are unique across inputs, and a stale file from an earlier
  run is removed first, so a failed render never leaves an old image behind.
- Mermaid blocks are found in blockquotes and lists too; a Mermaid example
  shown inside another fence (```` ```text ````) is not treated as a diagram.

## Step 5 — Review (optional)

Visual review is separate from the gate. Do it when the user asks, when an
Archify receipt recommends it, or for a tech-graph image (collisions are
common): open the HTML/PNG in the browser or use `/ak:preview --diagram`.
Claim visual quality only after looking.

## Step 6 — Place and report

- Put the diagram next to the prose it explains; add the Archify HTML link
  and the Mermaid overview to the page.
- Reply in the user's language: what was drawn and where (clickable paths),
  the engine and why in one line, each gate's status, and anything left out
  for lack of evidence.

## Rules

- Writes: the Markdown being edited, `docs/diagrams/` (or the `--dir`
  given), and `{plan_dir}/visuals/`. Nothing else.
- Never edit `ak:mermaidjs-v11`, `ak:tech-graph`, `ak:excalidraw` or the
  installed Archify package; this skill only calls them.
- No commit, push or publish unless the user asks.
- Do not send diagram source to a remote renderer (Kroki, mermaid.ink,
  hosted Archify sharing) without the user's approval; it publishes the
  content.
- Hand-drawn whiteboard sketch → `/ak:excalidraw`. Report page → `/ak:render`.

## Self-test (kit maintainers)

```bash
node --test engineer/skills/ak-diagram/scripts/ak-diagram.test.cjs
DIAG render engineer/skills/ak-diagram/references/workflow.md --check
```

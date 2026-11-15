---
name: ak:render
description: "Compile a short YAML Page Spec into one offline, themed HTML report with the AK Render CLI instead of hand-writing HTML. Use for plan reviews, diff reviews, recaps, decision briefs, verification reports, dashboards and other fact-based pages; saves most of the tokens hand-written HTML costs."
user-invocable: true
when_to_use: "Invoke when a result reads better as a page than terminal text: plan or diff review, recap, decision brief, verification/handoff report, KPI dashboard, timeline, checklist or risk review."
category: utilities
keywords: [HTML, report, page-spec, YAML, dashboard, recap, review, offline]
argument-hint: "--plan-review [plan] | --diff [ref] | --recap [window] | --decision <question> | --verify | --recipe <name> | --edit <spec> | --doctor | <free intent>"
metadata:
  author: agentkit
  version: "1.0.0"
  attribution: "Wraps AK Render (@bestagentkits/render) by bestagentkits, MIT, https://github.com/bestagentkits/ak-render"
  license: MIT
---

# Render

Describe **what a page says** as a YAML Page Spec; the AK Render compiler owns
layout, theme, typography, accessibility and security, and emits one
self-contained HTML file that opens offline. The agent writes a few kB of YAML
instead of the whole page, and never reads the HTML back; upstream measured
60–80% fewer tokens than agent-written HTML across 12 pages.

AK Render is a **report renderer**, not a frontend builder. For slides,
Mermaid-heavy diagrams or Markdown viewing use `/ak:preview`; for product UI
use `/ak:frontend-development`.

All commands below run from the project root. `RENDER` means `node` plus the
`scripts/ak-render.cjs` that sits next to this `SKILL.md` in the registry you
loaded it from, for example in Claude Code:

```bash
node .claude/skills/ak-render/scripts/ak-render.cjs
```

Each wrapper command prints one JSON object and never prompts. Exit codes:
`0` ok, `1` spec/compile error (fix and retry), `2` usage error, `3` BLOCKED.

## No arguments

Infer the mode from the conversation (a plan just written → `--plan-review`,
a finished change → `--verify`, a diff under review → `--diff`). If nothing
fits, ask once which page the user wants, offering the modes in Step 1.

## Step 0 — Doctor (once per session)

```bash
RENDER doctor
```

It checks Node ≥ 20.11, resolves the CLI at the pinned version (global install
→ npx cache → `npx`, no shell), and reports `version`, `capabilities`, `themes` and `blocks`.
**Use only the blocks, themes and commands it lists.** The upstream docs
describe an unreleased main branch; the pinned npm release (0.3.0) lacks
`compose`, `repair`, `patch`, `audit-ui`, `decision`/`feedback` and more. See
`references/cli-capabilities.md`.

- `pin` is the version the wrapper asks for: `AK_RENDER_VERSION` when set,
  otherwise the default `0.3.0` in `scripts/ak-render.cjs`.
- `version` is the CLI that actually answered. `pinMismatch: true` appears
  only when `AK_RENDER_BIN` points at a different build; then say which
  version rendered the page.
- A `false` capability is not a failure. It means that step is skipped and
  reported `NOT_RUN` with a reason.

If doctor exits `3` (no Node, no network for the first download), report
`BLOCKED` with its `error` and offer `/ak:preview --html <mode>` as the
degraded path. Do not hand-write HTML under this skill's name.

## Step 1 — Pick the mode and collect evidence

| Argument | Starter | Evidence to collect first |
| --- | --- | --- |
| `--plan-review [plan]` | `plan-review` | active plan `plan.md` + phase files + files they name |
| `--diff [ref]` | `diff-review` | `git diff --numstat` / `--name-status` / `git log` for the scope; review findings |
| `--recap [window]` | `recap` | `git log --since`, `git status --short`, plan statuses, journal |
| `--decision <question>` | `decision-brief` | brainstorm/advise output, user constraints |
| `--verify` | `verification-report` | commands actually run this session and their exit codes |
| `--recipe <name>` | `recipe:<name>` | whatever the recipe's blocks need |
| free intent | none | `RENDER exec -- search-catalog <words>` then `describe` |

Exact commands, block choices and routing live in
`references/agentkit-modes.md`; load it for any mode above.

**Never invent data.** Every number, date, name, path, status and finding
must come from the conversation, the repository or tool output in this
session. If a value is unknown, delete that block or ask. A check without
observed output is `NOT_RUN`, never `PASS`.

- **Missing source vs zero.** If the source does not exist (no `plans/`, no
  journal), delete the block. Show `"0"` only when a command ran and returned
  zero (for example an empty `git status --short`).
- **Counts match lists.** Take a count and the list it summarises from the
  same command output, then check that they agree before building (a stat of
  commits equals the number of timeline entries, unless the timeline says it
  shows only the latest N). Prefer `git rev-list --count` for commit counts.
- **Say only what the source says.** Describe a commit, plan or finding with
  its own subject or text. Do not add scope, numbers or motives it does not
  state.
- **Every number has a command.** Each `stats`/`kpi` value needs a `# src:`
  comment naming the command whose output is exactly that number. A number
  you counted or inferred yourself does not qualify; drop that item.
- **No invented next steps.** A next-steps list or recommendation appears only
  when a plan, journal or the user states it. Otherwise delete the block.

## Step 2 — Create the spec

```bash
RENDER paths "<topic>" [--plan-dir plans/<plan-id>]    # where it will go
RENDER init <starter> "<topic>" [--plan-dir plans/<plan-id>]
```

Output lives beside other visuals: `{plan_dir}/visuals/<slug>.page.yaml` and
`<slug>.html`, or `plans/visuals/` with no active plan. The slug follows
`/ak:preview` rules and folds Vietnamese (`Kế hoạch` → `ke-hoach`). `init`
refuses to overwrite an existing spec unless `--force`; prefer editing it.

Fill the spec:

1. Replace every `<<placeholder>>` with evidence; delete blocks you cannot fill.
2. Before using a block not in the starter, run
   `RENDER exec -- describe <type...> --compact` (≤ 12 types per call).
3. Give every block an `id`; prefix it with `# src: <command or file>`.
4. Set `meta.locale` to the user's language (`vi`, `en`) and write all page
   text you author in that language. Vietnamese keeps its full diacritics
   (`2 tuần gần nhất`, never `2 tuan gan nhat`); the spec is UTF-8 and the
   compiler embeds Vietnamese fonts. Template labels in English (`Activity`,
   `What happened`) are translated too. Quoted source text such as commit
   subjects stays as written.
5. Follow the YAML pitfalls in `references/spec-authoring.md` — quote any value
   with `: `, numbers in `stats`/`kpi` `value` and `table` cells, and flow-list
   cells containing commas. Keep short props within their length limits
   (titles and checklist items ≤ 200 characters, `stats` values ≤ 60).

## Step 3 — Build

```bash
RENDER build <spec> [--out <file.html>] [--theme <preset>] [--no-open]
```

One call runs: placeholder gate → Vietnamese accent check (only for
`locale: vi`) → `validate` → safe `repair` (only when the CLI
has it) → compile → `audit-ui` (only when the CLI has it) → open once. It
returns `{ ok, steps[], out, bytes, hash, theme, warnings, opened }` or the
failing `stage` with `diagnostics`.

Each `steps[]` entry has a `status`: `PASS`, `FAIL`, `PARTIAL` (safe repair
left errors) or `NOT_RUN` with a `reason`. `ok: true` with a `NOT_RUN` step
whose reason is `not supported by ak-render <version>` is a successful build:
report that step as `NOT_RUN`, not as an error. On the pinned 0.3.0, `repair`
and `audit-ui` are always `NOT_RUN`, so fix validation errors by hand and
mention that no visual audit ran.

- On `stage: placeholders`, a `<<...>>`, `TODO`, `TBD` or lorem ipsum is
  still in the spec: fill it from evidence or delete the block. Pass
  `--allow-placeholders` only when the page text itself must contain such a
  word.
- On `stage: vietnamese-accents`, `meta.locale` is `vi` but none of the prose
  you wrote has Vietnamese diacritics. Rewrite it with full accents and
  translate English labels, then build again.
- On `stage: validate`, fix each diagnostic **at its JSON `path`**
  (`details.allowed` lists valid props), then build again. At most two repair
  rounds; then report the remaining diagnostics instead of guessing.
- On `stage: audit-ui`, inspect the returned findings and fix the spec before
  rebuilding. A failed audit returns exit `1` and does not open the page.
- The page opens only when the HTML is new. If it already existed, tell the
  user to refresh the tab. `--no-open`, `CI` or `AK_RENDER_NO_OPEN=1` never open.
- **Never** read, print, grep or post-process the generated HTML. The summary
  is the evidence. Don't add HTML/CSS/JS: the spec has no field for it and
  `rawHTML`, `script`, `iframe`, `srcdoc`, `javascript:` are rejected.
- Pages stay offline (`policy.network: deny`). Opt into remote images only when
  the user asks for remote media.

## Step 4 — Edit, don't rewrite

To change a page, edit only the affected block by its `id`, then `build`
again. With a CLI that lists `patch`, prefer
`RENDER exec -- patch <spec> '<RFC 6902 ops on /blocks/@id/...>' --json`
with `--base-hash` from the previous reply. Never regenerate the whole spec
for a small change; never edit the HTML.

`--edit <spec>` means: read the spec (not the HTML), apply the requested
change, build.

## Step 5 — Report

Tell the user, in their language:

- the HTML path (and the spec path for later edits), theme, CLI version;
- `opened` or "refresh the open tab";
- each `steps[]` status (`PASS` / `FAIL` / `NOT_RUN` with reason);
- any data you left out because no evidence existed.

## Themes

Use `doctor`'s list. Mode defaults: plan-review `blueprint`, diff
`data-console`, recap `editorial`, decision `executive-report`, verify
`swiss-clean`. Change theme with `--theme` rather than editing the spec when
the user only wants another look. Do not try to restyle a page.

## Self-test (kit maintainers)

```bash
node --test engineer/skills/ak-render/scripts/ak-render.test.cjs   # offline unit tests
RENDER selftest                                                   # every template validates and compiles
```

## MCP

The wrapper is the default. A local `ak-render mcp` server or the hosted
remote server is described in `references/mcp-and-remote.md`. Adding an MCP
server is a configuration change: propose it, never write `.mcp.json` or
settings yourself. Never send private code or data to the hosted server
without the user's approval, and never echo an AgentKit token.

## Rules

- Only add files under the chosen `visuals/` directory; no other writes.
- No commit, push or publish of generated pages unless the user asks.
- Pin the CLI version (`AK_RENDER_VERSION` takes an exact version only).
- If a block, theme or command the user asks for is missing from `doctor`,
  say which CLI version would have it and use the closest available block.

# AgentKit modes

Each mode names the evidence to collect, the starter, and the blocks to use.
Collect evidence **before** writing the spec; every value on the page must
trace to one of these sources. Prefix a block with a YAML comment naming its
source (`# src: git diff --numstat main...HEAD`) so a later edit can refresh it.

| Mode | Starter | Theme default |
| --- | --- | --- |
| `--plan-review [plan]` | `init plan-review` | `blueprint` |
| `--diff [ref]` | `init diff-review` | `data-console` |
| `--recap [window]` | `init recap` | `editorial` |
| `--decision <question>` | `init decision-brief` | `executive-report` |
| `--verify` | `init verification-report` | `swiss-clean` |
| `--recipe <name>` | `init recipe:<name>` | recipe's own |
| free intent | `search-catalog` + minimal spec | `editorial` |

## --plan-review

Evidence:

- the active plan from the hook's `## Plan Context`, or the path the user gave;
- `plan.md` frontmatter (`status`), Outcome Contract, non-goals, acceptance criteria;
- every `phase-NN-*.md`: title and exit criterion;
- each file the plan names: does it exist (`Glob`), what changes.

Blocks: `hero`, `stats`, `key-value` (contract), `steps` (phases), `file-tree`
(blast radius, `status: added|modified|deleted`), `risk-matrix`, `code-review`
(gaps between plan and code), `checklist` (acceptance criteria, `done` only
when proven), `callout` (open decisions). On a CLI with `decision` and
`feedback`, put each open question in a `decision` with the recommended option
marked, and end with one `feedback` block.

Output goes into the plan: `--plan-dir plans/<plan-id>`.

## --diff [ref]

Evidence (pick the scope like `/ak:preview` does: branch, commit, range, PR,
default `main...HEAD`):

```text
git diff --numstat <base>...HEAD        # additions/deletions per file
git diff --name-status <base>...HEAD    # A/M/D/R status
git log --oneline <base>..HEAD          # commit count and subjects
```

Map name-status letters: `A` added, `M` modified, `D` deleted, `R*` renamed.
Binary files show `-` in numstat: omit `additions`/`deletions` for them.

Blocks: `hero`, `kpi` (files, +, -), `diff-summary`, `code-review`
(good/bad/ugly/concern/question, each with `path:line` evidence),
`test-results` (only checks actually run), `callout` verdict. Findings come
from a real review (`/ak:code-review`), not from the page builder.

## --recap [window]

Evidence: `git log --since=<window> --oneline`, `git rev-list --count`,
`git status --short`, plan statuses under `plans/`, journal entries. Default
window 2 weeks, same shorthand as `/ak:preview --recap` (2w, 30d, 3m).

Blocks: `hero`, `stats`, `timeline` (newest first or oldest first, say which),
`table` of decisions with source, `checklist` of current state, `list` of next
steps.

Consistency checks before `build`:

```text
git rev-list --count --since="<window>" HEAD          # the commit stat
git log --since="<window>" --format='%h|%cs|%an|%s'   # the timeline rows
git status --short                                    # open work (empty = "0")
```

- The commit stat equals the number of rows from the same `git log` call. If
  the timeline shows fewer, title it with the count it shows ("8 commit mới
  nhất") and keep the full count in the stat.
- Each timeline `text` restates the commit subject or body. Leave `text` out
  rather than guess what a commit changed.
- Drop the decisions table and next-steps list when no plan, journal or user
  statement supplies them.
- Note when the snapshot is a worktree or detached checkout: its
  `git status` is not the main checkout's.

## --decision <question>

Evidence: `/ak:brainstorm` or `/ak:advise` output, constraints the user stated,
scout findings. Blocks: `hero`, `callout` (recommendation first), `table`
(options vs cost/risk/reversibility), `comparison`, `risk-matrix`,
`checklist` of questions for the user.

## --verify

The AgentKit handoff as a page. Evidence: the commands actually run in this
session with exit codes. Status values are exactly `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`; a check without observed output is `NOT_RUN`, never
`PASS`. Put the gate rows in `datasets.gates` once and bind the `data-table`
with `dataRef: gates`; derive the `stats` counts from the same rows.

## Routing against /ak:preview

| Need | Use |
| --- | --- |
| Report-style page from facts (plan, diff, recap, dashboard, verification) | `/ak:render` |
| Slides / deck | `/ak:preview --html --slides` (AK Render has no slide mode) |
| Mermaid-heavy diagram, zoomable architecture | `/ak:preview --html --diagram` or `/ak:mermaidjs-v11` |
| Viewing an existing Markdown file | `/ak:preview <file.md>` |
| Real product frontend | `/ak:frontend-development` (AK Render is not a frontend builder) |
| Node unavailable, or `doctor` BLOCKED | `/ak:preview --html <mode>` as the degraded path |

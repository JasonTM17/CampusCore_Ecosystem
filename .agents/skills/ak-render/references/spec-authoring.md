# Writing a Page Spec that validates first time

## Shape

```yaml
version: 1
meta:
  title: Short page title          # plain text, no markup
  description: One sentence.
  locale: vi                       # a language tag: vi, en, en-US
theme:
  preset: editorial                # a name `themes` lists
datasets:                          # optional, shared rows
  runs:
    - name: a
      value: 1
blocks:
  - type: hero
    id: hero                       # give every block you may edit an id
    title: Title
```

Confirm each block's props with `describe <type...> --compact` (up to 12 types
per call) before writing it. An unknown prop fails with `details.allowed`.

## YAML pitfalls the validator caught in this skill's own templates

| Symptom | Cause | Fix |
| --- | --- | --- |
| `expected a string` / `expected multiline text` at a text prop | an unquoted value contains `: ` so YAML made it a map (`text: Scope: main`) | quote it: `text: "Scope: main"` |
| `row has 4 cells but the table declares 3 columns` | a comma inside a flow list split a cell (`[a, b, c, d]`) | quote cells: `["a", "b, c", "d"]` |
| `is not valid (a language tag ...)` at `meta.locale` | free text in `locale` | `vi` or `en` |
| `unknown block type` | block exists only on a newer CLI | check `catalog`; see `cli-capabilities.md` |
| `expected a string` at a `stats`/`kpi` `value` or a `table` cell | an unquoted number (`value: 12`, `[1.0]`) or `null` | quote it: `value: "12"`; numeric props such as `additions` stay numbers |

## Length limits

Short `string` props are bounded; a longer value fails `validate` at its path.
Read exact bounds with `describe <type> --json` (`maxLength`, `maxItems`).
Observed on 0.3.0:

| Prop | Max length |
| --- | --- |
| block `title`, `hero.title`, `checklist` item `text`, `timeline` item `title`, `stats` item `label` | 200 |
| `hero.eyebrow`, `timeline` item `when` | 80 |
| `stats` item `value` | 60 |
| `list` item `badge` | 40 |

Keep these to one short line; put detail in a multiline `text` or
`description` prop, or split it into several items.

`yes`, `no` and dates such as `2026-10-22` stay strings (YAML 1.2), so they
need no quotes. Also quote strings that start with `*`, `&`, `!`, `%`, `@`, `` ` ``, `{` or
`[`, and any string containing ` #` (YAML starts a comment there).

## Text and markup

- Prose props (`text`, `description`, item `text`) render a backtick pair as
  inline code: write commands, paths and identifiers as `` `git status` ``.
- `**bold**` renders only on CLIs newer than 0.3.0; on 0.3.0 it shows the
  asterisks literally, so do not use it there.
- `meta.title`, `code` and `terminal` content stay literal.
- No HTML, CSS or JS anywhere. Keys such as `rawHTML`, `iframe`, `srcdoc` and
  `script` are rejected; `javascript:` links are rejected.
- Vietnamese text renders with embedded Vietnamese font subsets; no setup.

## Data

- Put numbers several blocks show in `datasets` once and bind with
  `dataRef: <name>`; a column `key` the rows lack fails with `details.allowed`.
- `percent` columns take `87` for 87%.
- `data-table` badge colours: `tones: { PASS: success, FAIL: danger }`.
- Never compute a number the source does not give; leave the block out.

## Editing an existing page

1. Keep the spec (`*.page.yaml`) next to the HTML; it is the source of truth.
2. Change only the block that changed, addressed by its `id`. On a CLI with
   `patch`, send RFC 6902 ops to `/blocks/@<id>/...` with `--base-hash`; on
   0.3.0, use a precise file edit of that block.
3. Rebuild with the wrapper. Do not read the HTML back.

## Size and determinism

A page is ~125 kB because fonts are embedded; it opens offline from
`file://`. The same spec, theme and CLI version always produce the same bytes
and `hash`, so a changed hash means one of those changed.

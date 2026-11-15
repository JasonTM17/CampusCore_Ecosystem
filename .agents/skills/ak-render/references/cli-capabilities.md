# AK Render CLI capabilities by version

The upstream README and skill describe the **main branch**, which is ahead of
the newest npm release. Never assume a command, block, theme or flag exists:
`node scripts/ak-render.cjs doctor` reports what the installed version really
supports, and `catalog` / `describe` are the only contract.

Observed on 2026-10-22 against npm `@bestagentkits/render@0.3.0`
(published 2026-10-06) and upstream `main` at commit `1e89280`.

## Commands

| Command | 0.3.0 (npm) | main (unreleased) | Fallback on 0.3.0 |
| --- | --- | --- | --- |
| `<spec> --out x.html --json` (compile) | yes | yes | — |
| `validate <spec> --json` | yes | yes | — |
| `validate --suggest` (JSON Patch fixes) | **no** | yes | read `details.allowed` and fix by `path` |
| `repair <spec> --out <spec>` (safe fixes) | **no** | yes | fix by hand, one diagnostic per path |
| `catalog [--category c]` | yes | yes | — |
| `search-catalog <words>` | yes (English) | yes (+ Vietnamese) | search English words |
| `describe <type...> --compact` | yes | yes | — |
| `recipes`, `recipe <name>` | yes (10 recipes) | yes (11, + `newspaper`) | — |
| `themes` | yes (10 presets) | yes (12 presets) | — |
| `mcp` (stdio) | yes | yes | — |
| `compose <input> --out ...` | **no** | yes | use a recipe or a skill template |
| `patch <spec> <ops>` (RFC 6902 by `@id`) | **no** | yes | edit the YAML block by its `id` with a file edit |
| `audit-ui <spec>` | **no** | yes | open the page; `/ak:web-testing` for a browser check |
| `icons ...`, `motions ...`, `motion audit/studio` | **no** | yes | leave `icon` and `motion` out |

Stdin (`-` as the spec path) works on 0.3.0.

## Blocks

0.3.0 ships **83** block types. These exist only on main and fail with
`unknown block type` on 0.3.0:

- `decision`, `feedback` (reader answers a plan inside the page)
- `publication-header`, `editorial-layout`, `story`, `digest-list` (newspaper pages)
- the `icon` prop on cards, callouts, alerts, buttons and stats items
- `hero.actions`, `**bold**` inline markup (0.3.0 renders only backtick code)
- `transform.derive`, `transform.rollup`, `kpi` item `cite`

On 0.3.0, ask open plan questions with a `checklist` of questions plus a
`callout`, and tell the user to answer in chat.

## Themes

0.3.0: `blueprint`, `data-console`, `editorial`, `executive-report`,
`paper-ink`, `product-studio`, `research-notebook`, `swiss-clean`,
`terminal-mono`, `warm-signal`.

main adds `crimson-press` and `newspaper`. Use only a name `themes` lists.

## Pinning

The wrapper pins `0.3.0` (`DEFAULT_VERSION` in `scripts/ak-render.cjs`).
Override per run with `AK_RENDER_VERSION=<exact version>`; `latest` and ranges
are refused so a page does not change bytes because npm moved. To try main,
build the upstream repository yourself and point `AK_RENDER_BIN` at its
`dist/cli.js`; `doctor` then reports the extra commands and the wrapper uses
them (`repair`, `audit-ui`) automatically.

## Runner resolution

`scripts/ak-render.cjs` resolves, in order, without a shell:

1. `AK_RENDER_BIN` (a `cli.js` run with Node, or an executable);
2. a global `ak-render` on `PATH` (its package `dist/cli.js`), only when its
   version equals the pin;
3. the exact pinned version already in the npx cache (skips the ~9 s npx
   resolution measured per call on Windows);
4. `npx -y @bestagentkits/render@<pin>` through npm's own JS entry.

Only the last step on Windows without a findable npm entry falls back to a
shell, and it refuses arguments containing shell metacharacters.

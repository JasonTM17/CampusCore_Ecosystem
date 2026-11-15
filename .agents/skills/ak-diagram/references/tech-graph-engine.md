# tech-graph engine

Use only when the route is `image`: a styled static SVG/PNG for a slide,
blog post or README hero. Style references, shape vocabulary and arrow
semantics live in `/ak:tech-graph`; load its `SKILL.md` and the numbered
style reference you pick. This file covers the data contract the wrapper
feeds to its generator.

## Command

```bash
DIAG tech-graph <template> <out.svg> <data.json> [--png]
```

The wrapper runs `ak-tech-graph/scripts/generate-from-template.py` from the
same registry with Python 3, sending the JSON on stdin (no command-line
length limit) with UTF-8 forced so Windows consoles do not crash on its
status marks, then:

| Step | Status values |
| --- | --- |
| `generate` | `PASS` / `FAIL` with the generator's error |
| `svg-shape` | `PASS` when the file is one `<svg>` document |
| `svg-safety` | `FAIL` (and the SVG is deleted) when it contains `<script>`, `<foreignObject>`, event-handler attributes, a `set`/`animate` of `href`, a link that is not `#id`, a processing instruction such as `<?xml-stylesheet?>`, a script URL, `@import`, or a CSS load (`url()`, `image-set()`, `src()` …) that is not `#id`. A second pass parses the SVG with Python's XML parser and allows only plain SVG drawing elements and presentation attributes, local `#id` references, a few CSS value functions (`rgb()`, `url(#id)`, transforms), no CSS escapes, at-rules, DOCTYPE or `xml:base`; the generator does not escape every style value, so markup in the data JSON can reach the SVG |
| `rsvg-validate` | `PASS` / `FAIL` from `rsvg-convert`, `NOT_RUN` when it is missing |
| `png` (with `--png`) | 1920 px wide PNG next to the SVG, `NOT_RUN` without `rsvg-convert` |

Install `rsvg-convert` from librsvg (`brew install librsvg`,
`apt install librsvg2-bin`) before promising a PNG. On Windows,
conda-forge needs no admin rights and leaves other toolchains alone:
`micromamba create -p <dir> -c conda-forge librsvg`, then put
`<dir>/Library/bin` on `PATH` (or `scoop shim add rsvg-convert
<dir>/Library/bin/rsvg-convert.exe`). MSYS2
`pacman -S mingw-w64-x86_64-librsvg` also works on an up-to-date MSYS2.

## Templates

With an SVG base template: `architecture`, `agent-architecture`,
`data-flow`, `flowchart`, `sequence`, `state-machine`, `er-diagram`,
`timeline`, `use-case`, `comparison-matrix`. Drawn on a default canvas:
`agent`, `memory`, `class`, `comparison`, `mind-map`, `network-topology`.
Use the fixture's `template_type` when you start from a fixture.

## Data shape

Keep the data in `<slug>.tech-graph.json` next to the SVG so the image can be
regenerated. Working examples: `ak-tech-graph/fixtures/*.json`, one per
style. Read the closest fixture before writing new data.

| Key | Meaning |
| --- | --- |
| `template_type`, `style` | template name and style number 1–7 |
| `width`, `height` | canvas size; omit to use the template's own canvas (960 wide, height set per template); set both for a wide or tall layout |
| `title`, `subtitle` | heading text |
| `containers[]` | grouping boxes: `x`, `y`, `width`, `height`, `label`, optional `header_prefix`, `subtitle`, `stroke`, `fill`, `stroke_dasharray` |
| `nodes[]` | `id`, `kind`, `x`, `y`, `width`, `height`, `label`, optional `sublabel`, `type_label`, `fill`, `stroke`, `flat` |
| `arrows[]` | `source`, `target` (node ids), optional `source_port`/`target_port` (`left`, `right`, `top`, `bottom`), `flow`, `label`, `dashed`, `route_points` |
| `legend[]` | `label` with `flow` or `color` |

Node `kind` values: `rect` (default), `double_rect`, `cylinder`, `hexagon`,
`circle`, `circle_cluster`, `document`, `folder`, `terminal`, `user_avatar`,
`bot`, `speech`, `icon_box`.

Arrow `flow` values: `data`, `read`, `write`, `control`, `async`,
`feedback`. Add a `legend` entry for each flow used when there are two or
more.

## Rules

- Prefer `source`/`target` ids over raw coordinates so the generator routes
  arrows to node edges.
- Keep labels to one to three words; text that does not fit is the most
  common defect.
- After a `PASS`, look at the PNG (or open the SVG in a browser) before
  calling it done: collisions and crossings are not caught by the gate.

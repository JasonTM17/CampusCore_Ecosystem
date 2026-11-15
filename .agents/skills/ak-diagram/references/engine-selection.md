# Engine selection

Load when the user asks why an engine was chosen, names a tool this kit does
not wrap, or `DIAG route` looks wrong for the request.

## The three wrapped engines

| Question | Mermaid | Archify | tech-graph |
| --- | --- | --- | --- |
| Renders on GitHub without a build | yes | no (link the HTML) | as an image file |
| Source diffs as text | yes, inline | yes, typed JSON | yes, data JSON |
| Interactive (focus, routes, motion) | no | yes | no |
| Code-backed evidence markers | no | yes (`--repo-root`) | no |
| Comfortable size | ≤ ~20 nodes | 8–12 core components plus cards; larger maps | one poster-sized view |
| Styled for slides/blogs | basic themes | dark/light themes, exports | 7 curated styles |
| Needs | nothing on GitHub; mermaid-cli + Chromium to check locally | Archify installed (Node ≥ 18) | Python 3; `rsvg-convert` for PNG |

Decision order, as implemented by `DIAG route`:

1. The output's destination decides first (docs → Mermaid, repo/interactive →
   Archify, styled image → tech-graph).
2. Size: more than ~20 nodes inline moves to Archify plus a Mermaid overview.
3. Capability: a kind an engine cannot draw moves to one that can.
4. The user's explicit choice overrides all of the above.

## Kind coverage

| Kind | Mermaid | Archify | tech-graph template |
| --- | --- | --- | --- |
| architecture | `flowchart LR` (or `architecture-beta`, GitHub support varies) | `architecture` | `architecture` |
| workflow / process | `flowchart TD` | `workflow` | `flowchart` |
| sequence | `sequenceDiagram` | `sequence` | `sequence` |
| data flow | `flowchart LR` | `dataflow` | `data-flow` |
| state / lifecycle | `stateDiagram-v2` | `lifecycle` | `state-machine` |
| ERD | `erDiagram` | `erd` | `er-diagram` |
| class | `classDiagram` | `class` | — |
| tree / hierarchy | `mindmap` or `flowchart TD` | `tree` | — |
| timeline | `timeline` | `timeline` | `timeline` |
| gantt / roadmap | `gantt` | — | `timeline` |
| waterfall / spans | — | `waterfall` | — |
| agent / RAG / tools | `flowchart TD` | `workflow` | `agent-architecture` |
| mind map | `mindmap` | — | — |
| charts | `pie`, `quadrantChart`, `xychart` | — | `comparison-matrix` |

## Other diagram tools worth knowing

`ak:diagram` does not wrap these. Suggest one when its strength matches a
need the three engines do not cover, and say it is outside the kit's gates.

Snapshot 2026-11-11; recheck versions and licences before recommending one
for adoption. Of all of these, only Mermaid renders natively in GitHub
Markdown; the rest need a build step that commits SVG/PNG, or a docs site.

| Tool | Licence | Input → output | Offline CLI | Strong at | Watch out for |
| --- | --- | --- | --- | --- | --- |
| [D2](https://github.com/d2lang/d2) | MPL-2.0 | `.d2` → SVG, PNG, PDF, PPTX, GIF | yes | polished architecture with good auto-layout, layers, scenarios | another DSL; no GitHub rendering |
| [Structurizr DSL](https://docs.structurizr.com/dsl) | Apache-2.0 | workspace model + views → PNG/SVG, HTML, Mermaid, PlantUML | yes (CLI/Docker) | one C4 model driving consistent views | more structure than a drawing; exporters vary in fidelity |
| [LikeC4](https://github.com/likec4/likec4) | MIT | C4-style DSL → navigable static site, PNG, Mermaid, D2, draw.io | yes (PNG via Playwright) | living, clickable architecture docs | project setup heavier than one Mermaid file |
| [PlantUML](https://plantuml.com/) | GPL (LGPL/Apache/EPL/MIT builds exist) | text → PNG, SVG, PDF, LaTeX | yes (Java/native) | full UML, C4-PlantUML | large syntax; pick the build whose licence fits |
| [Graphviz](https://graphviz.org/) | EPL-2.0 | DOT → SVG, PNG, PDF, JSON | yes (`dot`) | generated dependency graphs, precise layout control | low-level; active source is GitLab (the GitHub mirror is archived) |
| [Kroki](https://github.com/yuzutech/kroki) | MIT (renderers vary) | HTTP API over many DSLs → SVG/PNG | self-host via Docker | one render backend for a mixed docs site | public endpoint is a data boundary; service upkeep |
| [Diagrams](https://github.com/mingrammer/diagrams) | MIT | Python code → PNG, SVG, PDF | yes (Python + Graphviz) | AWS/GCP/Azure/Kubernetes icons | static only; adds Python/Graphviz to the build |
| [Excalidraw](https://github.com/excalidraw/excalidraw) (`/ak:excalidraw`) | MIT | canvas JSON → PNG/SVG | app/PWA, no core CLI | hand-drawn whiteboard sketches | manual layout; not a semantic model |
| [draw.io](https://github.com/jgraph/drawio) | Apache-2.0 | `.drawio` XML → SVG, PNG, PDF, HTML | desktop app | visual editing for non-coders; icon libraries | noisy XML diffs; hand-edited |
| [Pikchr](https://pikchr.org/) | 0BSD | PIC-like text → SVG | yes | small precise illustrations | SVG only; small ecosystem |
| [nomnoml](https://github.com/skanaar/nomnoml) | MIT | small UML-ish text → SVG | yes (`npx nomnoml`) | compact class/component sketches | narrow scope; slow release pace |
| [bpmn-js](https://github.com/bpmn-io/bpmn-js) | MIT | BPMN 2.0 XML → SVG, editor | no CLI (browser toolkit) | formal business processes | overkill for software diagrams |
| [tldraw](https://github.com/tldraw/tldraw) | commercial SDK licence | canvas → SVG/PNG | no CLI | embeddable whiteboard in a product | production use needs a licence key |
| [Eraser](https://docs.eraser.io/) | commercial, hosted | DSL/canvas → PNG, SVG, PDF | no | collaborative diagrams, big icon catalog | hosted service; plan limits; portability |

## When to suggest which

| Need | First choice | Also good |
| --- | --- | --- |
| Diagram inside README/docs/PR | Mermaid | — |
| Architecture model with several consistent views (C4) | Structurizr DSL or LikeC4 | Mermaid C4 for a single small view |
| Large static architecture image with strong auto-layout | D2 | Graphviz |
| Interactive, code-backed explainer | Archify | — |
| Cloud infrastructure with provider icons | Diagrams (mingrammer) | D2 with icons |
| Full UML (deployment, component, activity) | PlantUML | Mermaid for the common subset |
| Docs site that must render many DSLs | Kroki, self-hosted | — |
| Whiteboard sketch | Excalidraw via `/ak:excalidraw` | tldraw |
| Non-developers editing visually | draw.io (`.drawio.svg` keeps the source) | Excalidraw |

Never send diagram source to a hosted renderer (public Kroki, mermaid.ink,
PlantUML server) without the user's approval: it publishes the content.

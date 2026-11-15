---
name: ak:doctor
description: "Read-only diagnosis of installed AgentKit skills, agents, duplicate registry names, hook/state capability and static-vs-runtime/provider evidence. Use when installation or routing looks incomplete."
user-invocable: true
argument-hint: "[--runtime codex|claude|cursor|gemini|opencode|omp|grok|zcode|antigravity|devin] [--deep]"
metadata:
  author: agentkit
  version: "1.0.0"
---

# Doctor

Run `node scripts/doctor.cjs --json` from this skill directory with `--root`
pointing to the project, or from a project root use its installed skill path.
By default it inspects available project-local runtime registries only, comparing
them with the full bundled canonical skill/agent roster. `--runtime <name>`
limits the report. For user-scoped installs, pass both `--skills-root <directory>`
and `--agents-root <directory>` together with `--runtime`; no global fallback is
inferred. Explicit roots establish inventory only; hook/configuration metadata
and project validators remain `NOT_RUN`. For project diagnosis, `--deep`
additionally runs existing read-only cross-reference and manifest validators
when their source and Python are available.

For Devin, select `--runtime devin`: inspect shared `.agents/skills`, native
`.devin/agents`, and the four sparse Office entries required by folder-based
native discovery. This is on-disk coverage. Use Devin's own `doctor --json` and
the source adapter's `test-devin-runtime.cjs` for fresh CLI/ACP evidence; CLI
login and explicit inference are required to prove a real named child result.
Hooks and session-state parity remain unsupported. Never treat a generic
profile reading a persona file as proof that a named native profile spawned.

Output: selected registry and static skill/agent health, missing or duplicate
capabilities, declared kit version/runtime delivery and ZCode plugin version when
available, hook configuration versus observed execution, session-state marker,
duration/error and measured stdout-byte aggregates from existing hook logs,
and runtime/provider gates. Bytes are not token usage; older unmetered entries
retain `contextStatus: NOT_RUN`.
Static configuration PASS is not proof of hook invocation, model routing or
provider behavior. Missing environments are `NOT_RUN` or `BLOCKED_CAPABILITY`.

The default command only reads. It never installs skills, repairs files, calls a
provider, changes credentials/config, runs a full suite or switches registries.
Hand exact missing paths and proposed repair to the controller; require separate
authorization for changes outside the accepted task. Complete when the report
is generated with clear limitations. An unreadable registry or ambiguous
duplicate is a reported failure, not an invented PASS.

See [capability levels](references/capability-levels.md) before claiming support.

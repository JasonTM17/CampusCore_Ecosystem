# Capability levels

| Level | Evidence | Claim allowed |
|---|---|---|
| Static registry | Skill/agent files, valid names, adapter config and manifest | Available on disk for selection |
| Hook execution | Actual event payload and observed handler result for that runtime | That event worked in the tested environment |
| Workflow runtime | Case-level command/browser/OS/database receipt at a scoped snapshot | Behavior worked for that case and environment |
| Provider | Authenticated model/service invocation with result and authority | Provider behavior on the observed version and cases |

Doctor reports static evidence only unless the operator supplies a verified
runtime/provider receipt. Hook presence means configured, not executed.
`NOT_RUN` means the check was not attempted; `BLOCKED_CAPABILITY` means a needed
runtime/marker/tool is unavailable. Never translate either into PASS.

For a consumer project with multiple AgentKit mirrors, select only the registry
appropriate to the current runtime. A mirror overlap is expected in the full
multi-runtime kit; duplicate names within the selected registry require repair.
Use explicit checkpoint validation for runtimes without a supported hook event.

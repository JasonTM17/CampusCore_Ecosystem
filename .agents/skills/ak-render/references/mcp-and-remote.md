# MCP server: local and remote

The CLI wrapper is the default path in AgentKit. Use MCP only when the runtime
already has the server configured, or the user asks for it.

## Local stdio (offline, no account)

```json
{
  "mcpServers": {
    "ak-render": {
      "command": "npx",
      "args": ["-y", "@bestagentkits/render@0.3.0", "mcp"]
    }
  }
}
```

- Pin the exact version, as above. An unpinned `npx` server changes behaviour
  whenever npm publishes.
- 0.3.0 serves `catalog`, `describe`, `recipes`, `recipe`, `validate`,
  `render` and `themes`. `render` writes the file to `out` (must end in
  `.html`/`.htm`) and returns only the summary. A relative `out` resolves
  against the server's start directory; an absolute or `..` path is written
  where it points, so review it like any file write.
- Adding the server to a project or user MCP config is a configuration change:
  propose it and wait for the user's yes. This skill never edits
  `.mcp.json` or `settings.json` itself.

## Remote (hosted, needs an AgentKit account)

`https://render.agentkit.best/mcp` (Streamable HTTP) serves the same tools,
but `render` returns an `artifactUrl` that lives one hour (`share: true` gives a
30-day link) instead of writing a file.

- It requires an OAuth sign-in or a personal key `ck_live_…`. Never paste,
  echo, log or commit that key; reference it as `${AGENTKIT_TOKEN}` in config
  and let the user set the variable.
- Sending a spec to the remote server publishes its content to a third party.
  Do not send private code, customer data or secrets there without the user's
  explicit approval for that page.
- Refusals come back as JSON codes: `ENTITLEMENT_INACTIVE`, `FORBIDDEN`,
  `RATE_LIMITED`, or HTTP 401 for a bad token. Report them; do not retry in a
  loop.

Local rendering never needs the network or a token, so prefer it.

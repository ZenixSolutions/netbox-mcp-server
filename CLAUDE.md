# CLAUDE.md

See [AGENTS.md](AGENTS.md) — it is the full runbook for installing, configuring, and
troubleshooting this MCP server, written for an AI assistant to follow step by step.

Quick orientation:

- This is a stdio MCP server for NetBox. Node >= 18, TypeScript, built with `npm run build` to `dist/index.js`.
- Requires `NETBOX_URL` and `NETBOX_TOKEN`. Optional: `NETBOX_INSECURE`, `NETBOX_READONLY`, `NETBOX_TOOL_GROUPS`.
- `./scripts/install.sh` does the dependency check, build, smoke test, and config generation.
- Never commit a NetBox token. Never run `sudo`. Do not modify `src/` when installing.

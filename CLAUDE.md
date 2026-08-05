# CLAUDE.md

See [AGENTS.md](AGENTS.md) — it is the full runbook for installing, configuring, and
troubleshooting this MCP server, written for an AI assistant to follow step by step.

Quick orientation:

- This is a stdio MCP server for NetBox. Node >= 20.11, TypeScript, built with `npm run build` to `dist/index.js`.
- Requires `NETBOX_URL` and `NETBOX_TOKEN`. Optional: `NETBOX_INSECURE`, `NETBOX_READONLY`, `NETBOX_TOOL_GROUPS`.
- Users install it by pointing their MCP client at `npx -y @zenixsolutions/netbox-mcp`. There is no install script; a clone and `npm ci && npm run build` is the contributor path.
- CLI verbs: `--help` (usage, reads no config), `--version`, `--check` (validates config: exit 0 usable, 78 not), `--list-tools` (prints every registered tool; needs no credentials).
- Never commit a NetBox token. Never run `sudo`. Do not modify `src/` when installing.

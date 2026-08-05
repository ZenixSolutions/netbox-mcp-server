# netbox-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives an AI
assistant read (and optionally write) access to your [NetBox](https://netbox.dev/)
instance — DCIM, IPAM, circuits, virtualization, tenancy, power, and the
`netbox-inventory` plugin.

Written in TypeScript on the official `@modelcontextprotocol/sdk`. Runs locally over
stdio as a subprocess of any MCP-aware client: Claude Desktop, Claude Code, Codex CLI,
Cursor, Continue.

> **Installing this?** Paste this into ChatGPT, Claude, or any assistant that can browse
> and run commands:
>
> > Read https://raw.githubusercontent.com/zenixsolutions/netbox-mcp-server/main/AGENTS.md
> > and follow it to install the NetBox MCP server on my Mac.
>
> [`AGENTS.md`](AGENTS.md) is a step-by-step runbook written for an AI assistant to
> execute without guessing — dependency checks, build, client config, and troubleshooting.
> Humans can use the Quick start below instead.

---

## Quick start

```bash
# 1. Clone
mkdir -p ~/mcp-servers && cd ~/mcp-servers
git clone https://github.com/zenixsolutions/netbox-mcp-server.git
cd netbox-mcp-server

# 2. Check dependencies, install, build, smoke-test
./scripts/install.sh
```

`install.sh` verifies Homebrew, git, and Node >= 18, runs `npm ci && npm run build`,
confirms the server answers a `tools/list` request, and prints a ready-to-paste client
config with the correct absolute paths filled in. It never runs `sudo`.

Then get a NetBox API token (**NetBox → your user menu → API Tokens → Add a token**) and
add the server to your client:

```json
{
  "mcpServers": {
    "netbox": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/YOU/mcp-servers/netbox-mcp-server/dist/index.js"],
      "env": {
        "NETBOX_URL": "https://netbox.yourcompany.com",
        "NETBOX_TOKEN": "your-api-token",
        "NETBOX_READONLY": "1"
      }
    }
  }
}
```

Claude Desktop reads `~/Library/Application Support/Claude/claude_desktop_config.json`.
Fully quit (Cmd-Q) and reopen it afterwards. Other clients:
[`AGENTS.md` § 6](AGENTS.md#6-configure-the-ai-client).

If you have `NETBOX_URL` and `NETBOX_TOKEN` exported, `./scripts/install.sh
--write-claude-config` will merge the entry in for you (backing up your existing config
first).

---

## What it exposes

**446 tools across 89 NetBox resources.** Every resource gets `netbox_list_<plural>`,
`netbox_get_<singular>`, `netbox_create_<singular>`, `netbox_update_<singular>` (PATCH
semantics), and `netbox_delete_<singular>` — plus `netbox_global_search`, which fans a
fuzzy query out across resources in parallel.

| Group             | Tools | Covers                                                                                                         |
| ----------------- | ----: | -------------------------------------------------------------------------------------------------------------- |
| `search`          |     1 | cross-resource fuzzy lookup                                                                                    |
| `dcim`            |    40 | sites, locations, racks, manufacturers, device types, device roles, platforms, devices, interfaces, cables     |
| `dcim_org`        |    20 | regions, site groups, rack roles, rack types, rack reservations                                                |
| `dcim_components` |    76 | modules, module/device bays, console + front + rear ports, MAC addresses, inventory items, and their templates |
| `ipam`            |    32 | prefixes, IP addresses, VLANs, VLAN groups, VRFs, aggregates, IP ranges, roles                                 |
| `ipam_org`        |    16 | RIRs, ASNs, ASN ranges, route targets                                                                          |
| `ipam_services`   |    24 | services, service templates, FHRP groups, VLAN translation policies + rules                                    |
| `inventory`       |    28 | `netbox-inventory` plugin: assets, suppliers, purchases, deliveries                                            |
| `power`           |    24 | power panels, feeds, ports, outlets, and templates                                                             |
| `tenancy`         |    24 | tenants, tenant groups, contacts, contact roles/groups/assignments                                             |
| `virtualization`  |    28 | clusters, cluster types/groups, VMs, VM interfaces, virtual disks                                              |
| `circuits`        |    44 | providers, provider accounts/networks, circuits, terminations, circuit groups, virtual circuits                |
| `deletes`         |    89 | `netbox_delete_*` for every resource                                                                           |

All list tools support:

- rich per-resource filters (site, status, role, tenant, VRF, …)
- universal filters — `q` (fuzzy text), `tag[]`, `created_after`, `created_before`
- pagination via `limit` / `offset`, with `has_more` and `next_offset` in the response
- `response_format` — `markdown` (default) or `json`
- automatic truncation at 25,000 characters, with guidance to paginate

---

## Configuration

| Variable             | Required | Default | Meaning                                                                                                                                         |
| -------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETBOX_URL`         | **yes**  | —       | Base URL of your NetBox, e.g. `https://netbox.corp.com`. **Omit `/api`** — the server appends it. A trailing `/` or `/api` is stripped for you. |
| `NETBOX_TOKEN`       | **yes**  | —       | NetBox API token.                                                                                                                               |
| `NETBOX_INSECURE`    | no       | off     | `1`/`true`/`yes` skips TLS certificate verification. For on-prem NetBox behind an internal CA.                                                  |
| `NETBOX_READONLY`    | no       | off     | `1`/`true`/`yes` registers only `list`, `get`, and `search` tools (179 total). Create, update, and delete tools are **not registered at all**.  |
| `NETBOX_TOOL_GROUPS` | no       | all     | Comma-separated allowlist of groups from the table above, e.g. `search,dcim,ipam`. Unknown names are ignored with a warning on stderr.          |

Both `NETBOX_READONLY` and `NETBOX_TOOL_GROUPS` default to off — with neither set, the
full 446-tool surface is registered, exactly as before these options existed.

### Suggested rollout profiles

```bash
# Most people: read-only, full visibility          -> 179 tools
NETBOX_READONLY=1

# Read-only, trimmed for clients that struggle
# with large tool counts                            ->  49 tools
NETBOX_READONLY=1
NETBOX_TOOL_GROUPS=search,dcim,ipam,tenancy

# Engineers who document as they work: write,
# but no delete tools exist at all                  -> 233 tools
NETBOX_TOOL_GROUPS=search,dcim,dcim_org,dcim_components,ipam,ipam_org,power,tenancy

# Administrators: everything, deletes included      -> 446 tools
# (set nothing)
```

`NETBOX_TOOL_GROUPS` is an explicit allowlist — anything you do not name is omitted,
**including `deletes`**. Name `deletes` deliberately if you want it.

---

## Verifying an install

```bash
# Does the server start and register tools?
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| NETBOX_URL=https://netbox.corp.com NETBOX_TOKEN=... node dist/index.js \
| tail -1 | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["result"]["tools"]))'

# Do the credentials work?
curl -sS -H "Authorization: Token $NETBOX_TOKEN" \
  "$NETBOX_URL/api/dcim/sites/?limit=1" | head -c 200

# Interactive exploration — starts a local web server and runs until Ctrl-C
npx @modelcontextprotocol/inspector node dist/index.js
```

Then ask your assistant: _"Using the netbox tools, list the first 5 sites."_

`./scripts/install.sh --check` re-runs just the dependency checks at any time.

---

## Troubleshooting

The most common failure by far: **`spawn node ENOENT` in a GUI client**. Claude Desktop
and ChatGPT are launched from Finder and never source your `~/.zshrc`, so a `node`
installed by nvm/fnm/asdf/Volta is invisible to them. Use the absolute path from
`which node` in the config, not the bare string `"node"`. `install.sh` detects this and
fills in the absolute path for you.

Claude Desktop logs each server separately:

```bash
tail -f ~/Library/Logs/Claude/mcp-server-netbox.log
```

Full table of symptoms and fixes: [`AGENTS.md` § 8](AGENTS.md#8-troubleshooting).

---

## Development

```bash
npm run dev     # tsx watch src/index.ts
npm run build   # tsc -> dist/
npm run clean
```

```
src/
  index.ts            entry point; registers tool groups
  constants.ts        character limits, env var names
  config.ts           env parsing / validation
  gating.ts           NETBOX_READONLY + NETBOX_TOOL_GROUPS
  client.ts           axios-based NetBox client
  errors.ts           friendly API error formatting
  formatting.ts       markdown rendering + pagination payload
  registrars.ts       list/get/create/update/delete tool factories
  schemas/common.ts   shared Zod schemas
  tools/              per-domain resource registrations
scripts/
  install.sh          macOS dependency check, build, config generator
```

Adding a resource means adding a descriptor + schemas in the relevant `tools/*.ts` file;
the registrars generate the five tools. New groups must also be added to
`ALL_TOOL_GROUPS` in `src/gating.ts` and wired in `src/index.ts`.

---

## Security notes

- The token is read only from `NETBOX_TOKEN`. It is never logged or echoed in a tool
  response.
- **The NetBox token is the real permission boundary.** Issue read-only tokens in NetBox
  itself for anyone who does not need write access; `NETBOX_READONLY` is a convenience
  layer that keeps the tools out of the model's context, not an enforcement mechanism.
- **Deletes cascade and cannot be undone.** NetBox removes dependent objects: deleting a
  device removes its interfaces, power ports, and assigned IPs; deleting a site can
  remove its racks, devices, and prefixes. `delete` tools carry `destructiveHint: true`
  and a description that insists on confirming first — but the safe posture for most
  users is to leave them unregistered.
- `NETBOX_INSECURE=1` disables TLS certificate validation entirely. Prefer installing
  your corporate root CA into the system keychain.
- Never commit a token. `.env` is gitignored; client configs live outside the repo.

---

## Contributing

Issues and pull requests welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

Security vulnerabilities should be reported privately, not as public issues. See
[SECURITY.md](SECURITY.md), which also covers how to operate this safely (token scoping,
cascading deletes, and prompt-injection risk with write access).

## Disclaimer

This is an independent, community-maintained project. It is not affiliated with,
endorsed by, or supported by NetBox Labs or the NetBox open-source project. "NetBox" is
a trademark of its respective owner.

Provided as-is under the MIT license. You are responsible for what an AI assistant does
with the credentials you give it — read the security notes above before granting write
access to a production NetBox instance.

## License

MIT — see [LICENSE](LICENSE).

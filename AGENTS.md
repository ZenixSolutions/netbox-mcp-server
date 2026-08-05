# AGENTS.md — Installation runbook for AI assistants

**You are an AI assistant (ChatGPT, Codex, Claude, Cursor, Gemini, or similar) helping a
person install this MCP server on their Mac. This file is your instruction set. Follow it
top to bottom. Do not improvise alternative install methods.**

If you are a human reading this, use [`README.md`](README.md) instead — it says the same
things in fewer words.

---

### Handing this to an AI assistant

Paste this into ChatGPT, Claude, or any assistant that can browse and run commands:

> Read https://raw.githubusercontent.com/zenixsolutions/netbox-mcp-server/main/AGENTS.md
> and follow it to install the NetBox MCP server on my Mac.

The repository is public, so the assistant can fetch that URL directly — no GitHub
account, no auth, no copy-pasting this file around.

If your assistant cannot browse the web but can run shell commands, have it clone the
repo first (section 4) and read `AGENTS.md` from disk.

---

## 0. What you are installing

`netbox-mcp-server` is a Model Context Protocol (MCP) server written in TypeScript. It
exposes a [NetBox](https://netbox.dev/) instance (the network / datacenter source of
truth) to an AI assistant as callable tools.

It runs **locally on the user's Mac** as a subprocess of their AI client, over **stdio**.
It is not a hosted service, there is no login page, and nothing is deployed anywhere.

Facts you may need:

| Property                          | Value                                                      |
| --------------------------------- | ---------------------------------------------------------- |
| Language / runtime                | TypeScript compiled to ESM JavaScript, Node.js **>= 18**   |
| Package manager                   | npm                                                        |
| Transport                         | stdio only                                                 |
| Entry point after build           | `dist/index.js`                                            |
| Required env vars                 | `NETBOX_URL`, `NETBOX_TOKEN`                               |
| Optional env vars                 | `NETBOX_INSECURE`, `NETBOX_READONLY`, `NETBOX_TOOL_GROUPS` |
| Total tools registered by default | **446**                                                    |

---

## 1. Rules for you, the assistant

1. **Never invent a NetBox URL or API token.** These are company-specific. If the user
   has not supplied them, stop and ask. Do not guess, and do not use the
   `https://netbox.example.com` placeholder from the docs as a real value.
2. **Never print, echo, log, or write an API token into a file you did not need to
   write.** The token belongs in exactly one place: the user's MCP client config, or
   their local `.env`. Never in a commit, a chat transcript summary, or a screenshot.
3. **Never run `sudo`.** Nothing in this install needs root. If a step appears to need
   root, something has gone wrong — stop and report it.
4. **Prefer the script.** Once the repo is cloned (section 4), `./scripts/install.sh`
   performs the dependency checks, build, and smoke test from sections 3, 5 and 7.1 in
   one deterministic pass, and prints a client config with the correct absolute paths
   already filled in. Run it instead of hand-rolling those commands. Section 3 is what
   you do _before_ the clone, and the reference for interpreting any check it fails.
5. **Do not modify `src/`.** You are installing, not developing.
6. **Check each command's exit code.** If a command fails, stop and consult section 8
   (Troubleshooting) rather than continuing to the next step.
7. **Ask before you overwrite.** Section 6 edits the user's existing AI-client config
   file. Back it up first and show the user the diff.

---

## 2. Preflight: gather what you need from the user

Before running anything, confirm you have all three. Ask for any that are missing.

| Item             | Looks like                                            | Where it comes from                                                          |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| NetBox base URL  | `https://netbox.yourcompany.com`                      | The company's NetBox instance. **No `/api` suffix** — the server appends it. |
| NetBox API token | 40 hex characters                                     | NetBox web UI → user menu → **API Tokens** → **Add a token**                 |
| Which AI client  | Claude Desktop / ChatGPT desktop / Codex CLI / Cursor | Ask the user                                                                 |

**Token permissions.** Tell the user to create the token with the narrowest permissions
that fit their job:

- **Read-only (recommended default for most people).** In NetBox, tick **"Read-only"** on
  the token. Then also set `NETBOX_READONLY=1` in the config (section 6) so the write
  tools are not even offered to the model. Belt and suspenders.
- **Read/write.** Only for people who are supposed to change infrastructure records.
  Leave "Read-only" unticked and omit `NETBOX_READONLY`.

Also have the user set an **expiry date** on the token, and restrict it to the office IP
range if the company uses that feature.

---

## 3. Dependency checks

Run these in order. Each block states the check, the expected result, and the fix.

### 3.1 Confirm macOS and architecture

```bash
uname -s   # expect: Darwin
uname -m   # expect: arm64 (Apple Silicon) or x86_64 (Intel)
```

If `uname -s` is not `Darwin`, this runbook does not apply — see section 9.

### 3.2 Xcode Command Line Tools (provides `git`)

```bash
xcode-select -p
```

- **Expected:** a path such as `/Library/Developer/CommandLineTools`.
- **If it errors:** run `xcode-select --install`. This opens a **GUI dialog**. You
  cannot click it. Tell the user: _"A macOS dialog just opened — click Install, accept
  the license, and tell me when it finishes (it takes a few minutes)."_ Then wait for
  the user before continuing. Do not poll in a loop.

### 3.3 Homebrew

```bash
which brew || echo "MISSING"
```

- **Expected:** `/opt/homebrew/bin/brew` (Apple Silicon) or `/usr/local/bin/brew` (Intel).
- **If MISSING:** Homebrew's installer is interactive — it prompts for the user's
  password and asks them to press RETURN. **Do not run it yourself in a non-interactive
  shell; it will hang.** Instead, give the user this to paste into their own Terminal:

  ```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/brew/HEAD/install.sh)"
  ```

  Then have them run the two `eval` lines Homebrew prints at the end (it adds brew to
  the PATH), and confirm with `brew --version` before you continue.

- **If `brew` exists but is not on PATH in your shell** (common when you are running
  commands non-interactively), add it for the session:

  ```bash
  eval "$(/opt/homebrew/bin/brew shellenv)"   # Apple Silicon
  eval "$(/usr/local/bin/brew shellenv)"      # Intel
  ```

### 3.4 Node.js 18 or newer

```bash
node --version   # expect: v18.x or higher
npm --version    # expect: 8.x or higher (Node 18 ships npm 8; Node 20+ ships 9/10)
```

Only the Node version matters. Do not report an npm 8.x install as a failure.

- **If Node is missing, or the major version is below 18:**

  ```bash
  brew install node
  ```

  If `brew install node` reports it is already installed but the version is still old:

  ```bash
  brew upgrade node
  ```

- **If the user manages Node with `nvm`, `fnm`, `asdf`, or Volta, do not install via
  Homebrew.** Use their version manager instead (e.g. `nvm install 20 && nvm use 20`).
  Detect this by checking whether `which node` points inside `~/.nvm`, `~/.local/share/fnm`,
  `~/.asdf`, or `~/.volta`.

  ⚠️ **Version-manager Node breaks GUI clients.** Claude Desktop and ChatGPT desktop are
  launched from Finder, not from a shell, so they never source `~/.zshrc` and will not
  find a version-manager `node`. If the user is on nvm/fnm/asdf/Volta, you **must** use
  the absolute path to the node binary (`which node`) in the client config in section 6,
  not the bare string `"node"`. This is the single most common cause of "the server
  won't start" and it produces a confusing, silent failure.

### 3.5 Confirm outbound access to NetBox

Export the URL the user gave you in section 2 first — later steps reuse it, and this
keeps it out of each individual command:

```bash
export NETBOX_URL="https://netbox.theircompany.com"   # the real value from section 2
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 10 "$NETBOX_URL/api/status/"
```

Do **not** export `NETBOX_TOKEN` the same way — see the note in section 7.1.

- **Expected:** `403` or `401` (the API is reachable but you sent no token) — that is a
  _success_ for this check.
- **`200`:** also fine.
- **`000` / timeout:** DNS or network failure. The NetBox instance is probably internal —
  ask the user whether they need to be on the corporate VPN.
- **TLS error mentioning a self-signed or unknown-authority certificate:** the company
  uses an internal CA. Note this; you will set `NETBOX_INSECURE=1` in section 6. Flag to
  the user that the better fix is installing the corporate root CA into the system
  keychain, and that `NETBOX_INSECURE=1` disables certificate validation.

---

## 4. Get the code

The repository is **public** — no GitHub account or authentication is required to clone
it.

```bash
mkdir -p ~/mcp-servers
cd ~/mcp-servers
git clone https://github.com/zenixsolutions/netbox-mcp-server.git
cd netbox-mcp-server
```

- **If `git` is not installed**, see step 3.2.
- **If the clone fails with a proxy or TLS error**, the user is likely behind a corporate
  proxy. Ask them for the proxy URL and set `git config --global http.proxy <url>`, or
  have them download the ZIP from the repository's **Code → Download ZIP** button and
  unpack it to `~/mcp-servers/netbox-mcp-server`.
- **If the clone prompts for credentials**, something is wrong — a public repo over HTTPS
  never prompts. Check the URL for typos.

**Note the absolute path** — you need it in section 6:

```bash
pwd   # e.g. /Users/alice/mcp-servers/netbox-mcp-server
```

To update an existing checkout later:

```bash
cd ~/mcp-servers/netbox-mcp-server
git pull
npm ci && npm run build
```

Then restart the AI client.

## 5. Build

```bash
npm ci
npm run build
```

- `npm ci` installs exactly the versions in `package-lock.json`. Use it rather than
  `npm install`.
- **If `npm ci` fails because there is no lockfile**, fall back to `npm install`.
- `npm run build` runs `tsc` and writes `dist/`. It should print nothing on success.

Verify the build produced an entry point:

```bash
test -f dist/index.js && echo "BUILD OK"
node dist/index.js --help
```

`--help` prints the server banner and every environment variable the server reads. It
exits 0 and needs no credentials.

If it prints `Cannot find module`, the build did not produce that file — re-run
`npm run build` and read its output. If `npm run build` itself reports TypeScript errors,
the checkout is broken or modified; re-clone rather than trying to fix `src/`.

---

## 6. Configure the AI client

### The easy path: let the script do it

If the user is on Claude Desktop, `install.sh` will merge the entry in for you — it backs
up the existing file, preserves every other configured server, and validates the result:

```bash
cd ~/mcp-servers/netbox-mcp-server
export NETBOX_URL="https://netbox.theircompany.com"
read -rs NETBOX_TOKEN && export NETBOX_TOKEN      # prompts without echoing
./scripts/install.sh --write-claude-config
```

It writes `NETBOX_READONLY=1` unless you export `NETBOX_READONLY=0`, and prints which
mode it used. If that works, skip to section 7.

For any other client, or if the script is unavailable, edit by hand as below.

### Editing a config by hand

**Rules that apply to every client:**

- Use the **absolute** path to `dist/index.js`. Tildes (`~`) are **not** expanded by MCP
  clients.
- Use the absolute path to `node` (see 6.0 below).
- **This is a MERGE, not an overwrite.** The user almost certainly has other MCP servers
  configured. Read the existing file, add one key, write it back. Never write one of the
  templates below verbatim over an existing file — you would silently delete every other
  server they have.
- **Back it up first**, then validate before you consider the step done. A malformed
  config makes the client drop _all_ MCP servers, not just this one, which is a
  maddening failure to debug.

```bash
# Set this once to the config path for the user's client, from the section below.
CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

# 1. Back up (only if it already exists)
[ -f "$CONFIG_PATH" ] && cp "$CONFIG_PATH" "$CONFIG_PATH.bak.$(date +%Y%m%d%H%M%S)"

# 2. ... make your edit ...

# 3. Validate
python3 -m json.tool < "$CONFIG_PATH" > /dev/null && echo "JSON OK"
```

If step 3 fails, restore the backup immediately and try again — do not leave a broken
config in place.

### 6.0 Which `node` path to use

```bash
which node
```

Use that **exact absolute path** as `command` in every template below. It is typically
`/opt/homebrew/bin/node` on Apple Silicon or `/usr/local/bin/node` on Intel, but under a
version manager it will be something under `~/.nvm`, `~/.volta`, etc. — and in that case
the absolute path is mandatory, not merely preferred (see 3.4). Do not copy the example
paths in the templates below; substitute what `which node` actually returned.

### 6.1 Claude Desktop (macOS)

Config path:

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Create it if it does not exist. Add **only** this one entry inside the existing
`mcpServers` object, leaving every other server in place:

```json
"netbox": {
  "command": "ABSOLUTE_PATH_FROM_WHICH_NODE",
  "args": ["/Users/USERNAME/mcp-servers/netbox-mcp-server/dist/index.js"],
  "env": {
    "NETBOX_URL": "https://netbox.theircompany.com",
    "NETBOX_TOKEN": "PASTE_TOKEN_HERE",
    "NETBOX_READONLY": "1"
  }
}
```

So a file that previously held one server ends up looking like:

```json
{
  "mcpServers": {
    "their-existing-server": { "command": "...", "args": ["..."] },
    "netbox": { "command": "...", "args": ["..."], "env": { "...": "..." } }
  }
}
```

If the file does not exist yet, create it with `{"mcpServers": {"netbox": { ... }}}`.

Then tell the user to **fully quit and reopen Claude Desktop** — Cmd-Q, not just closing
the window. The config is read once at launch.

### 6.2 Codex CLI (OpenAI)

Config path: `~/.codex/config.toml`

```toml
[mcp_servers.netbox]
command = "ABSOLUTE_PATH_FROM_WHICH_NODE"
args = ["/Users/USERNAME/mcp-servers/netbox-mcp-server/dist/index.js"]

[mcp_servers.netbox.env]
NETBOX_URL = "https://netbox.theircompany.com"
NETBOX_TOKEN = "PASTE_TOKEN_HERE"
NETBOX_READONLY = "1"
```

Note the key is `mcp_servers` (underscore) in TOML, unlike the JSON clients. As with
JSON, add this table to the existing file — do not replace it.

### 6.3 ChatGPT desktop app

ChatGPT's support for locally-launched stdio MCP servers has changed repeatedly and
differs by plan and OS, so this runbook cannot pin an exact file format the way it can
for the other clients. **Do not guess at one, and do not invent a config file path.**

Do this instead:

1. Have the user open **ChatGPT → Settings** and look for **Connectors**, **Developer
   mode**, or **MCP servers**. Ask them to read you what they see.
2. If there is a UI for adding a local/stdio server, fill it in with the three values you
   already have — they are the same for every client:
   - command: the absolute path from `which node`
   - argument: the absolute path to `dist/index.js`
   - environment: `NETBOX_URL`, `NETBOX_TOKEN`, and optionally `NETBOX_READONLY=1`
3. If the settings offer **only** remote servers over HTTP/SSE, stop. This server is
   stdio-only and cannot be used with that build as-is. Say so plainly rather than
   improvising a tunnel or a proxy — and offer Claude Desktop, Codex CLI, or Cursor
   (sections 6.1, 6.2, 6.4) as working alternatives on the same machine.
4. If you have web access and the user wants you to check current support, consult
   OpenAI's official ChatGPT documentation. Report what it says; do not extrapolate.

### 6.4 Cursor

Config path: `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project). Same JSON
shape as Claude Desktop in 6.1.

### 6.5 Claude Code (CLI)

```bash
claude mcp add netbox \
  --env NETBOX_URL="$NETBOX_URL" \
  --env NETBOX_TOKEN="$NETBOX_TOKEN" \
  --env NETBOX_READONLY=1 \
  -- "$(which node)" /Users/USERNAME/mcp-servers/netbox-mcp-server/dist/index.js
```

Claude Code is launched from a shell, so it inherits the user's PATH and a bare `node`
would also work here — but `$(which node)` costs nothing and stays correct if they later
switch Node versions.

---

## 7. Verify the install

### 7.1 Handshake test (does not need the client)

This only checks that the server starts and registers tools — it does not contact NetBox,
so **the token does not need to be real here.** Do not put the user's actual token on a
command line: it lands in their shell history and is visible in `ps` to every process on
the machine.

```bash
cd ~/mcp-servers/netbox-mcp-server
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| NETBOX_URL="https://placeholder.invalid" NETBOX_TOKEN="placeholder" node dist/index.js \
| tail -1 | python3 -c 'import sys,json; print("tools:", len(json.load(sys.stdin)["result"]["tools"]))'
```

**Expect `tools: 446`.** This command sets no gating variables, so it always reports the
full surface — even if you configured `NETBOX_READONLY=1` in section 6. That is correct
and not a sign that gating is broken. To confirm gating itself works, re-run with
`NETBOX_READONLY=1` added before `node` and expect `tools: 179`.

**If it prints nothing, or a Python traceback:** the server exited before responding.
Pipe nothing into it and read the error directly:

```bash
NETBOX_URL="https://placeholder.invalid" NETBOX_TOKEN="placeholder" node dist/index.js --help
```

A `Cannot find module` means the build is missing — go back to section 5.

### 7.2 Live credential test

Confirms the URL and token actually work against NetBox:

Have the user paste the token into a shell variable without echoing it, so it stays out
of history:

```bash
read -rs NETBOX_TOKEN && export NETBOX_TOKEN      # user pastes, presses Enter; nothing is shown
curl -sS -H "Authorization: Token $NETBOX_TOKEN" \
  "$NETBOX_URL/api/dcim/sites/?limit=1" | head -c 300
```

Expect JSON with a `count` field.

- `{"detail":"Invalid token."}` — bad, expired, or revoked token.
- `{"detail":"Authentication credentials were not provided."}` — the variable is empty;
  the paste did not take.
- HTML instead of JSON — `NETBOX_URL` points at something that is not NetBox, or at a
  login portal / SSO proxy in front of it.

### 7.3 End-to-end test in the client

Have the user restart their AI client and ask it: **"Using the netbox tools, list the
first 5 sites."** A correct install returns real site names from the company's NetBox.

---

## 8. Troubleshooting

| Symptom                                                                | Cause                                                           | Fix                                                                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client shows no netbox tools at all                                    | Client not restarted                                            | Fully quit (Cmd-Q) and reopen                                                                                                                                                   |
| Client shows no netbox tools; other MCP servers also vanished          | Malformed JSON in the config                                    | Validate with `python3 -m json.tool`                                                                                                                                            |
| `spawn node ENOENT` in client logs                                     | GUI app can't find a version-manager `node`                     | Use the absolute path from `which node` in the config — see 3.4                                                                                                                 |
| `Cannot find module '.../dist/index.js'`                               | Not built, or wrong path in config                              | `npm run build`; confirm path with `pwd`                                                                                                                                        |
| `Missing required environment variable NETBOX_URL`                     | Env block absent or misspelled in config                        | Check the `env` object; names are case-sensitive                                                                                                                                |
| `{"detail":"Invalid token."}`                                          | Wrong/expired/revoked token                                     | Create a new one in NetBox                                                                                                                                                      |
| `403 Forbidden` on a create/update                                     | Token is read-only, or the NetBox user lacks object permissions | Expected if intentional; otherwise widen permissions in NetBox                                                                                                                  |
| `ETIMEDOUT` / `ENOTFOUND`                                              | NetBox is internal-only                                         | Connect to the corporate VPN                                                                                                                                                    |
| `unable to verify the first certificate` / `SELF_SIGNED_CERT_IN_CHAIN` | Internal CA                                                     | Install the corporate root CA (best), or set `NETBOX_INSECURE=1` (weakens security)                                                                                             |
| Client is slow, or ignores/misuses the tools                           | 446 tools is a lot of context for one client                    | Narrow with `NETBOX_TOOL_GROUPS` — see section 10                                                                                                                               |
| `git clone` fails behind a proxy                                       | Corporate proxy intercepting TLS                                | Set `git config --global http.proxy <url>`, or download the ZIP from the repo's Code button                                                                                     |
| `npm ci` fails with `EACCES`                                           | A previous `sudo npm` left root-owned files in the npm cache    | **Stop and hand this to the user** — it needs root, which you must not use. Tell them to run `sudo chown -R "$(whoami)" ~/.npm` in their own Terminal, then say when it is done |

**Reading client logs.** Claude Desktop writes per-server logs to
`~/Library/Logs/Claude/mcp-server-netbox.log`. Read that file first when a server fails
to appear — the actual Node error is almost always in it.

---

## 9. Non-macOS

The server itself is cross-platform; only the dependency steps differ.

- **Windows:** `winget install OpenJS.NodeJS.LTS` and `winget install Git.Git`. Claude
  Desktop config lives at `%APPDATA%\Claude\claude_desktop_config.json`. Paths in the
  config must use escaped backslashes (`"C:\\Users\\..."`) or forward slashes.
- **Linux:** install Node 18+ from NodeSource or your distro (`apt install nodejs npm`,
  `dnf install nodejs`); verify with `node --version`, since distro packages are often
  older than 18.

Everything from section 4 onward is identical apart from paths.

---

## 10. Environment variable reference

| Variable             | Required | Default | Meaning                                                                                                                                                     |
| -------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETBOX_URL`         | **yes**  | —       | Base URL, no `/api` suffix. A trailing `/api` or `/` is stripped automatically.                                                                             |
| `NETBOX_TOKEN`       | **yes**  | —       | NetBox API token.                                                                                                                                           |
| `NETBOX_INSECURE`    | no       | off     | `1`/`true`/`yes` disables TLS certificate verification. Internal CAs only.                                                                                  |
| `NETBOX_READONLY`    | no       | off     | `1`/`true`/`yes` registers only `list`/`get`/`search` tools. Create, update, and delete tools are **not registered at all**, so the model cannot call them. |
| `NETBOX_TOOL_GROUPS` | no       | all     | Comma-separated allowlist of tool groups. Unknown names are ignored with a warning.                                                                         |

### Tool groups and their sizes

| Group             | Tools | Covers                                                                                                     |
| ----------------- | ----: | ---------------------------------------------------------------------------------------------------------- |
| `search`          |     1 | `netbox_global_search` — fuzzy lookup across every resource                                                |
| `dcim`            |    40 | sites, locations, racks, manufacturers, device types, device roles, platforms, devices, interfaces, cables |
| `dcim_org`        |    20 | regions, site groups, rack roles, rack types, rack reservations                                            |
| `dcim_components` |    76 | modules, bays, console/front/rear ports, MAC addresses, inventory items, and their templates               |
| `ipam`            |    32 | prefixes, IP addresses, VLANs, VLAN groups, VRFs, aggregates, IP ranges, roles                             |
| `ipam_org`        |    16 | RIRs, ASNs, ASN ranges, route targets                                                                      |
| `ipam_services`   |    24 | services, service templates, FHRP groups, VLAN translation                                                 |
| `inventory`       |    28 | netbox-inventory plugin: assets, suppliers, purchases, deliveries                                          |
| `power`           |    24 | power panels, feeds, ports, outlets, and templates                                                         |
| `tenancy`         |    24 | tenants, tenant groups, contacts, contact roles/groups/assignments                                         |
| `virtualization`  |    28 | clusters, VMs, VM interfaces, virtual disks                                                                |
| `circuits`        |    44 | providers, circuits, terminations, virtual circuits                                                        |
| `deletes`         |    89 | `netbox_delete_*` for every resource — **destructive, cascading**                                          |

`NETBOX_TOOL_GROUPS` is an explicit allowlist: anything you do not name is omitted,
including `deletes`. Setting it to `search,dcim,ipam` yields 73 tools with no ability to
delete anything.

**Recommended profiles:**

```bash
# Most employees — read-only, everything visible
NETBOX_READONLY=1

# Lean read-only for a client that struggles with large tool counts
NETBOX_READONLY=1
NETBOX_TOOL_GROUPS=search,dcim,ipam,tenancy

# Network engineers who document as they work — write, but never delete
NETBOX_TOOL_GROUPS=search,dcim,dcim_org,dcim_components,ipam,ipam_org,power,tenancy

# Full surface (default) — administrators only
```

---

## 11. Safety notes to pass on to the user

- **Deletes cascade.** `netbox_delete_site` can remove that site's racks, devices, and
  prefixes. NetBox has no undo. This is why `deletes` is opt-in under
  `NETBOX_TOOL_GROUPS` and absent entirely under `NETBOX_READONLY`.
- **NetBox is a source of truth, not the network.** Writing to it changes documentation,
  not device configuration — but downstream automation may read it and act.
- **The token carries the permissions of the NetBox user who created it.** A read-only
  token is the real enforcement boundary; `NETBOX_READONLY` is a convenience layer on
  top, not a substitute.
- **Tokens must not be committed.** `.env` is gitignored. Config files under
  `~/Library/Application Support/` are outside the repo and safe.

---

## 12. Done

The install is complete when section 7.3 returns real data from the company's NetBox.
Report back to the user: where the repo was cloned, which config file you edited (and
where the backup went), whether you enabled `NETBOX_READONLY`, and the tool count from
section 7.1. You cannot see the client's own view of the tool list — do not claim a
number you did not measure.

If something in this runbook was wrong or out of date, tell the user — the repository is
public and accepts issues at
https://github.com/zenixsolutions/netbox-mcp-server/issues.

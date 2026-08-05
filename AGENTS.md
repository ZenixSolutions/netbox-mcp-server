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

| Property                          | Value                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| Language / runtime                | TypeScript compiled to ESM JavaScript, Node.js **>= 20.11** |
| npm package                       | `@zenixsolutions/netbox-mcp`, binary name `netbox-mcp`      |
| Normal install                    | `npx -y @zenixsolutions/netbox-mcp` — no clone, no build    |
| Transport                         | stdio only                                                  |
| Required env vars                 | `NETBOX_URL`, `NETBOX_TOKEN`                                |
| Optional env vars                 | `NETBOX_INSECURE`, `NETBOX_READONLY`, `NETBOX_TOOL_GROUPS`  |
| Total tools registered by default | **446**                                                     |

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
4. **Do not clone or build unless section 4 tells you to.** The normal install is a
   config file pointing at `npx -y @zenixsolutions/netbox-mcp`. There is no install
   script — if you find a reference to `scripts/install.sh` anywhere, it is stale; it was
   deleted. Do not write one.
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

Only needed if you end up on the from-a-clone path in section 4B. Skip it for a normal
`npx` install.

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

### 3.4 Node.js 20.11 or newer

```bash
node --version   # expect: v20.11.0 or higher
npx --version    # expect: 10.x or higher (any npx that ships with Node 20+)
```

`package.json` declares `"engines": { "node": ">=20.11" }` and CI tests Node 20 and 22
only. Node 18 is end-of-life and is **not** supported — do not report a Node 18 install
as acceptable. `npm ci` only warns about this (`EBADENGINE`) and keeps going, so a Node
18 machine can appear to work and then fail later with no useful log.

- **If Node is missing, or the version is below 20.11:**

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

  ⚠️ **A GUI client cannot find `npx` or `node` on your PATH.** Claude Desktop and
  ChatGPT desktop are launched from Finder, not from a shell, so they never source
  `~/.zshrc`. This bites hardest under nvm/fnm/asdf/Volta, but it also happens with a
  plain Homebrew install. You **must** put the absolute path from `command -v npx` in the
  client config in section 6, not the bare string `"npx"`. This is the single most common
  cause of "the server won't start" and it produces a confusing, silent failure
  (`spawn npx ENOENT` in the client log).

  ```bash
  command -v npx    # e.g. /opt/homebrew/bin/npx — write this exact path into the config
  ```

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

## 4. Get the server

### 4A. The normal path: `npx` (no clone, no build)

The server is distributed on npm as `@zenixsolutions/netbox-mcp`. The client launches it
with `npx`, which downloads it on first use and caches it — nothing is cloned or built.
Confirm it resolves before you write any config:

```bash
npx -y @zenixsolutions/netbox-mcp --version
```

- **Expected:** a version number on stdout, e.g. `0.1.0`, and exit 0. You are done with
  this section — go to section 5.
- **`404 Not Found` / `E404`:** the package is not on the registry yet (the first release
  has not been published). Use path 4B.
- **`ETIMEDOUT`, `ECONNREFUSED`, `self-signed certificate in certificate chain`, or a
  proxy error:** the user's network blocks or intercepts the npm registry. Do not disable
  TLS verification to work around it. Use path 4B, or ask the user for their corporate
  proxy settings.

Record the absolute path you will put in the config:

```bash
command -v npx   # e.g. /opt/homebrew/bin/npx
```

**Note the version-floating trade-off, and tell the user.** Unpinned, `npx` resolves the
newest release whenever its cache misses, so the tool surface can change between client
restarts. Pin it in the config — `"@zenixsolutions/netbox-mcp@0.1.0"` — if the user wants
a fixed surface. Use the version `--version` just printed.

### 4B. From a clone (contributors, blocked registry, or unpublished package)

The repository is **public** — no GitHub account or authentication is required to clone
it.

```bash
mkdir -p ~/mcp-servers
cd ~/mcp-servers
git clone https://github.com/zenixsolutions/netbox-mcp-server.git
cd netbox-mcp-server
npm ci
npm run build
```

- **Run these in a shell with no `NETBOX_TOKEN` exported.** `npm ci` executes the install
  scripts of every package in the dependency tree, and each one inherits your
  environment. Do not export the token until section 6, and never write it into
  `~/.zshrc` or any other shell profile.
- **If `git` is not installed**, see step 3.2.
- **If the clone fails with a proxy or TLS error**, the user is likely behind a corporate
  proxy. Ask them for the proxy URL and set `git config --global http.proxy <url>`, or
  have them download the ZIP from the repository's **Code → Download ZIP** button and
  unpack it to `~/mcp-servers/netbox-mcp-server`.
- **If the clone prompts for credentials**, something is wrong — a public repo over HTTPS
  never prompts. Check the URL for typos.
- `npm ci` installs exactly the versions in `package-lock.json`. Use it rather than
  `npm install`. If it fails because there is no lockfile, fall back to `npm install`.
- `npm run build` runs `tsc` and writes `dist/`. It prints nothing on success. If it
  reports TypeScript errors, the checkout is broken or modified; re-clone rather than
  trying to fix `src/`.
- **If `npm ci` fails with `sh: tsc: not found` at the build step**, `NODE_ENV=production`
  is set in the environment: `npm ci` then omits devDependencies, and `typescript` is one.
  Re-run as `NODE_ENV=development npm ci`.

Confirm the build produced a working entry point, and note the absolute paths — you need
both in section 6:

```bash
test -f dist/index.js && echo "BUILD OK"
node dist/index.js --version    # expect the version, e.g. 0.1.0
pwd                             # e.g. /Users/alice/mcp-servers/netbox-mcp-server
command -v node                 # e.g. /opt/homebrew/bin/node
```

If `node dist/index.js --version` prints `Cannot find module`, the build did not produce
that file — re-run `npm run build` and read its output.

To update a clone later: `git pull && npm ci && npm run build`, then restart the AI
client. On the `npx` path there is nothing to update unless the config pins a version, in
which case edit the pin and restart the client.

---

## 5. The command-line surface

The binary is normally launched by a client, but it has four verbs. **These are your only
verification tools — use them instead of hand-rolling a JSON-RPC pipe.**

Write `npx -y @zenixsolutions/netbox-mcp` where the table says `netbox-mcp`, or
`node dist/index.js` from a clone.

| Command                   | Does                                                                                                | Exit code                       |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------- |
| `netbox-mcp --help`       | Prints usage and every environment variable the server reads.                                       | 0                               |
| `netbox-mcp --version`    | Prints the version, e.g. `0.1.0`.                                                                   | 0                               |
| `netbox-mcp --check`      | Validates configuration; names the first missing or invalid variable.                               | **0** usable, **78** not usable |
| `netbox-mcp --list-tools` | Prints every registered tool name to stdout; `N tools registered.` to stderr. Needs no credentials. | 0                               |

**`--help` cannot diagnose a configuration problem.** It returns before any configuration
is read, so it prints identical output whether the credentials are correct, wrong, or
absent. Prefixing it with `NETBOX_URL=... NETBOX_TOKEN=...` changes nothing. Use
`--check` — that is the verb that reads the configuration:

```bash
NETBOX_URL="$NETBOX_URL" NETBOX_TOKEN="$NETBOX_TOKEN" \
  npx -y @zenixsolutions/netbox-mcp --check      # clone path: node dist/index.js --check
echo "exit=$?"
```

- **Exit 0**, `ok: netbox-mcp-server v0.1.0 configured for https://netbox.theircompany.com`
  — the configuration is usable. `--check` does not contact NetBox; section 7.2 does that.
- **Exit 78** with `Missing required environment variable NETBOX_URL` or
  `Missing required environment variable NETBOX_TOKEN` — that variable is unset or empty
  in the environment you ran the command in. Set it and re-run.
- **Exit 78** with `NETBOX_URL is not a valid URL` — fix the value; it must look like
  `https://netbox.theircompany.com`, with no `/api` suffix.
- **`warning: NETBOX_INSECURE is set — TLS certificate verification is disabled.`** on
  stderr — report this to the user; it is not an error, but it is a security downgrade
  they should have chosen deliberately.

---

## 6. Configure the AI client

This step is a **hand edit of a JSON or TOML file**. There is no installer to do it for
you; the one that existed was deleted because it silently mis-reported the read-only
mode and left a world-readable copy of the token behind.

**Rules that apply to every client:**

- Use the absolute path to `npx` — or to `node`, on the clone path (see 6.0 below).
- On the clone path, use the **absolute** path to `dist/index.js` too. Tildes (`~`) are
  **not** expanded by MCP clients.
- **`NETBOX_READONLY` is only true for `1`, `true`, `yes`, `y`, or `on`** (case
  insensitive). Every other value — including `n`, `no`, `off`, `disabled`, and an empty
  string — leaves the server in read/write mode with all 446 tools, deletes included. If
  the user wants read-only, write the string `"1"`. Do not write `"0"` and describe it as
  anything other than read/write.
- **Never write the token into a shell profile**, a script, or any file other than this
  config.
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
BACKUP="$CONFIG_PATH.bak"

# 1. Back up (only if it already exists), and lock the copy down: it contains
#    every token in the user's config, and the default mode is world-readable.
[ -f "$CONFIG_PATH" ] && cp "$CONFIG_PATH" "$BACKUP" && chmod 600 "$BACKUP"

# 2. ... make your edit ...

# 3. Validate
python3 -m json.tool < "$CONFIG_PATH" > /dev/null && echo "JSON OK"

# 4. The file now contains an API token. The client created it world-readable.
chmod 600 "$CONFIG_PATH"

# 5. Once step 3 has printed JSON OK, delete the backup — it is a second copy of
#    the token that nothing will ever clean up.
rm -f "$BACKUP"
```

If step 3 fails, restore the backup immediately (`cp "$BACKUP" "$CONFIG_PATH"`) and try
again — do not leave a broken config in place, and do not delete the backup until the
validation passes.

### 6.0 Which `command` path to use

```bash
command -v npx    # npx path (section 4A) — e.g. /opt/homebrew/bin/npx
command -v node   # clone path (section 4B) — e.g. /opt/homebrew/bin/node
```

Use that **exact absolute path** as `command` in every template below. It is typically
under `/opt/homebrew/bin` on Apple Silicon or `/usr/local/bin` on Intel, but under a
version manager it will be something under `~/.nvm`, `~/.volta`, etc. — and in that case
the absolute path is mandatory, not merely preferred (see 3.4). Do not copy the example
paths in the templates below; substitute what the command actually returned.

### 6.1 Claude Desktop (macOS)

Config path:

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

On Windows it is `%APPDATA%\Claude\claude_desktop_config.json`.

Create it if it does not exist. Add **only** this one entry inside the existing
`mcpServers` object, leaving every other server in place.

**`npx` path (section 4A):**

```json
"netbox": {
  "command": "ABSOLUTE_PATH_FROM_COMMAND_V_NPX",
  "args": ["-y", "@zenixsolutions/netbox-mcp"],
  "env": {
    "NETBOX_URL": "https://netbox.theircompany.com",
    "NETBOX_TOKEN": "PASTE_TOKEN_HERE",
    "NETBOX_READONLY": "1"
  }
}
```

To pin the version, use `"@zenixsolutions/netbox-mcp@0.1.0"` as the second argument,
substituting the version `--version` printed in section 4A.

**Clone path (section 4B):**

```json
"netbox": {
  "command": "ABSOLUTE_PATH_FROM_COMMAND_V_NODE",
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
command = "ABSOLUTE_PATH_FROM_COMMAND_V_NPX"
args = ["-y", "@zenixsolutions/netbox-mcp"]
# Clone path instead:
#   command = "ABSOLUTE_PATH_FROM_COMMAND_V_NODE"
#   args = ["/Users/USERNAME/mcp-servers/netbox-mcp-server/dist/index.js"]

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
   - command: the absolute path from `command -v npx` (or from `command -v node` on the
     clone path)
   - arguments: `-y @zenixsolutions/netbox-mcp` (or the absolute path to `dist/index.js`)
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

Have the user paste the token into a variable without echoing it, register the server,
then clear the variable. Do not put the token in `~/.zshrc`.

```bash
read -rs NETBOX_TOKEN                        # user pastes and presses Enter; nothing is shown
claude mcp add netbox \
  --env NETBOX_URL="https://netbox.theircompany.com" \
  --env NETBOX_TOKEN="$NETBOX_TOKEN" \
  --env NETBOX_READONLY=1 \
  -- "$(command -v npx)" -y @zenixsolutions/netbox-mcp
unset NETBOX_TOKEN
```

On the clone path, replace the last line with
`-- "$(command -v node)" /Users/USERNAME/mcp-servers/netbox-mcp-server/dist/index.js`.

Verify with `claude mcp list` — the `netbox` entry should be listed. Claude Code is
launched from a shell, so it inherits the user's PATH and a bare `npx` would also work
here, but the absolute path stays correct if they later switch Node versions.

---

## 7. Verify the install

### 7.1 Tool registration test (does not need the client or NetBox)

`--list-tools` performs a real MCP handshake in-process and prints what a client would
receive. It contacts nothing and **needs no credentials at all** — do not put the user's
token on a command line, where it lands in shell history and is visible in `ps` to every
process on the machine.

```bash
npx -y @zenixsolutions/netbox-mcp --list-tools | wc -l
```

**Expect `446`.** `N tools registered.` also goes to stderr, so you will see
`446 tools registered.` alongside the count. From a clone, run
`node dist/index.js --list-tools | wc -l` in the repository directory instead.

This command sets no gating variables, so it always reports the full surface — even if
you configured `NETBOX_READONLY=1` in section 6. That is correct and not a sign that
gating is broken. To confirm gating itself works:

```bash
NETBOX_READONLY=1 npx -y @zenixsolutions/netbox-mcp --list-tools | wc -l   # expect 179
```

**If the count is 446 when you set `NETBOX_READONLY`,** the value is not one the server
recognises. Only `1`, `true`, `yes`, `y`, `on` (case insensitive) enable read-only; `n`,
`no`, `off` and anything else leave all 446 tools registered, deletes included. Fix the
value in the config and re-run.

**If it prints an error instead of a count:** on the `npx` path, re-read section 4A —
this is a registry or network problem, not a configuration one. On the clone path,
`Cannot find module` means the build is missing; go back to section 4B.

### 7.2 Configuration test

```bash
NETBOX_URL="$NETBOX_URL" NETBOX_TOKEN="$NETBOX_TOKEN" \
  npx -y @zenixsolutions/netbox-mcp --check; echo "exit=$?"
```

Expect `ok: netbox-mcp-server v0.1.0 configured for <their URL>` and `exit=0`. Exit 78
means the configuration is unusable and the message names the variable — see section 5
for the full list of outcomes. This validates the variables **in your shell**, which is
the same set you wrote into the config in section 6; it does not read the config file.

### 7.3 Live credential test

Confirms the URL and token actually work against NetBox:

Have the user paste the token into a shell variable without echoing it, so it stays out
of history. Do not add it to any shell profile, and unset it when you are done:

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

### 7.4 End-to-end test in the client

Have the user restart their AI client and ask it: **"Using the netbox tools, list the
first 5 sites."** A correct install returns real site names from the company's NetBox.

Then `unset NETBOX_TOKEN` in your shell — it is in the client config now and does not
need to live anywhere else.

---

## 8. Troubleshooting

| Symptom                                                                | Cause                                                           | Fix                                                                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client shows no netbox tools at all                                    | Client not restarted                                            | Fully quit (Cmd-Q) and reopen                                                                                                                                                   |
| Client shows no netbox tools; other MCP servers also vanished          | Malformed JSON in the config                                    | Validate with `python3 -m json.tool`                                                                                                                                            |
| `spawn npx ENOENT` / `spawn node ENOENT` in client logs                | GUI app can't find `npx`/`node` on your PATH                    | Use the absolute path from `command -v npx` in the config — see 3.4                                                                                                             |
| `E404 Not Found - @zenixsolutions/netbox-mcp`                          | Package not published yet, or the name is misspelled            | Check the spelling; otherwise build from a clone — section 4B                                                                                                                   |
| `Cannot find module '.../dist/index.js'`                               | Clone path: not built, or wrong path in config                  | `npm run build`; confirm path with `pwd`                                                                                                                                        |
| `Missing required environment variable NETBOX_URL`                     | Env block absent or misspelled in config                        | Check the `env` object; names are case-sensitive. Reproduce with `--check`, which names the variable and exits 78                                                               |
| Read-only was requested but delete tools are present                   | `NETBOX_READONLY` set to a value the server does not recognise  | Only `1`/`true`/`yes`/`y`/`on` count. Set it to `"1"` and confirm with `--list-tools \| wc -l` → 179                                                                            |
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

- **Windows:** `winget install OpenJS.NodeJS.LTS` (and `winget install Git.Git` only for
  the clone path). Claude Desktop config lives at
  `%APPDATA%\Claude\claude_desktop_config.json`. Paths in the config must use escaped
  backslashes (`"C:\\Users\\..."`) or forward slashes. The `command` is the absolute path
  to `npx.cmd`, from `where npx`.
- **Linux:** install Node 20.11+ from NodeSource or your distro (`apt install nodejs
npm`, `dnf install nodejs`); verify with `node --version`, since distro packages are
  often older than 20.11. There is no official Claude Desktop build for Linux; use Claude
  Code (6.5), Cursor (6.4), or Codex CLI (6.2). **Never create
  `~/Library/Application Support/` on Linux** — that is a macOS-only path, and a config
  written there is read by nothing.

Everything from section 4 onward is identical apart from those paths: sections 3.1–3.3
are macOS-specific, and every command in sections 4, 5 and 7 is cross-platform.

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
- **`NETBOX_READONLY` is only recognised as `1`, `true`, `yes`, `y`, or `on`.** Any other
  value leaves the full 446-tool surface registered. Verify with
  `--list-tools | wc -l` (179 = read-only) rather than assuming.
- **Tokens must not be committed.** `.env` is gitignored. Config files under
  `~/Library/Application Support/` are outside the repo. They are plaintext, so keep them
  at mode `600` and do not leave `.bak` copies of them lying around.

---

## 12. Done

The install is complete when section 7.4 returns real data from the company's NetBox.
Report back to the user:

- which install path you used (`npx`, pinned or unpinned, or a clone and its path);
- which config file you edited, and that you deleted the backup after validating it;
- the exact `NETBOX_READONLY` value you wrote, and the tool count from section 7.1 that
  confirms it — 179 for read-only, 446 for the full surface. Do not describe an install
  as read-only on the strength of the value you intended to write; say the number you
  measured.

You cannot see the client's own view of the tool list — do not claim a number you did
not measure.

If something in this runbook was wrong or out of date, tell the user — the repository is
public and accepts issues at
https://github.com/zenixsolutions/netbox-mcp-server/issues.

#!/usr/bin/env bash
#
# netbox-mcp-server installer / doctor for macOS.
#
#   ./scripts/install.sh              check dependencies, build, smoke test, print config
#   ./scripts/install.sh --check      dependency checks only; no install, no build
#   ./scripts/install.sh --write-claude-config
#                                     all of the above, then merge a 'netbox' entry into
#                                     Claude Desktop's config. Requires NETBOX_URL and
#                                     NETBOX_TOKEN to be exported. Backs the file up
#                                     first and preserves any other MCP servers.
#                                     Sets NETBOX_READONLY=1 unless you export
#                                     NETBOX_READONLY=0.
#
# Never runs sudo. Never installs Homebrew for you (its installer is interactive) —
# it tells you the one command to paste instead.
#
set -euo pipefail

MODE="install"
WRITE_CLAUDE=0
for arg in "$@"; do
  case "$arg" in
    --check)                MODE="check" ;;
    --write-claude-config)  WRITE_CLAUDE=1 ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
else
  BOLD=''; RED=''; GRN=''; YEL=''; DIM=''; RST=''
fi

ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$1"; }
bad()  { printf '  %s✗%s %s\n' "$RED" "$RST" "$1"; FAILED=1; }
head_() { printf '\n%s%s%s\n' "$BOLD" "$1" "$RST"; }
note() { printf '    %s%s%s\n' "$DIM" "$1" "$RST"; }

# ---------------------------------------------------------------- dependencies

head_ "Checking dependencies"

# --- OS -----------------------------------------------------------------
case "$(uname -s)" in
  Darwin) ok "macOS $(sw_vers -productVersion 2>/dev/null || echo '?') on $(uname -m)" ;;
  *)      warn "not macOS ($(uname -s)) — this script targets macOS; see AGENTS.md section 9" ;;
esac

# --- Homebrew (informational: only needed if Node is missing) ------------
BREW=""
for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  [ -x "$candidate" ] && BREW="$candidate" && break
done
if [ -z "$BREW" ] && command -v brew >/dev/null 2>&1; then
  BREW="$(command -v brew)"
fi
if [ -n "$BREW" ]; then
  ok "Homebrew $("$BREW" --version 2>/dev/null | head -1 | awk '{print $2}') at $BREW"
  eval "$("$BREW" shellenv)" 2>/dev/null || true
else
  warn "Homebrew not found (only needed if Node is missing)"
  note 'install by pasting into Terminal:'
  # shellcheck disable=SC2016  # literal command for the user to paste, must not expand
  note '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/brew/HEAD/install.sh)"'
fi

# --- git ----------------------------------------------------------------
# On macOS /usr/bin/git is a stub that exists even without the Xcode Command
# Line Tools, and invoking it pops a GUI installer dialog. Check for the tools
# themselves first so we never trigger that by surprise.
if [ "$(uname -s)" = "Darwin" ] && ! xcode-select -p >/dev/null 2>&1; then
  bad "Xcode Command Line Tools not installed (provides git)"
  note 'run: xcode-select --install   (a macOS dialog will open — click Install)'
  note 'then re-run this script once it finishes'
elif command -v git >/dev/null 2>&1 && GIT_VERSION="$(git --version 2>/dev/null)"; then
  ok "git $(echo "$GIT_VERSION" | awk '{print $3}')"
else
  bad "git not found or not working"
  note 'run: xcode-select --install   (a macOS dialog will open — click Install)'
fi

# --- Node ---------------------------------------------------------------
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "node $(node --version) at $NODE_BIN"
  else
    bad "node $(node --version) is too old (need >= 18)"
    note 'run: brew upgrade node'
  fi
else
  bad "node not found (need >= 18)"
  note 'run: brew install node'
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm $(npm --version)"
else
  bad "npm not found — reinstall node"
fi

# --- python3 (used by the smoke test and the config writer) --------------
if command -v python3 >/dev/null 2>&1 && PY_VERSION="$(python3 --version 2>&1)"; then
  ok "$PY_VERSION"
else
  bad "python3 not found or not working"
  note 'macOS ships python3 with the Xcode Command Line Tools (see above)'
fi

# --- Node version manager warning ---------------------------------------
# GUI clients (Claude Desktop, ChatGPT) don't source ~/.zshrc, so a
# version-manager node is invisible to them unless the config uses an
# absolute path.
VERSION_MANAGED=0
case "$NODE_BIN" in
  *"/.nvm/"*|*"/fnm"*|*"/.asdf/"*|*"/.volta/"*|*"/.nodenv/"*) VERSION_MANAGED=1 ;;
esac
if [ "$VERSION_MANAGED" = 1 ]; then
  warn "node is managed by a version manager ($NODE_BIN)"
  note 'GUI apps launched from Finder will NOT find it via the bare name "node".'
  note 'The generated config below uses the absolute path — keep it that way.'
fi

if [ "$FAILED" = 1 ]; then
  printf '\n%s%sDependency checks failed.%s Fix the ✗ items above and re-run.\n' "$BOLD" "$RED" "$RST"
  exit 1
fi

# --- NetBox reachability (optional, only if NETBOX_URL is exported) ------
if [ -n "${NETBOX_URL:-}" ]; then
  # curl already prints 000 on connection failure, so don't append another.
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
          "${NETBOX_URL%/}/api/status/" 2>/dev/null)" || true
  code="${code:-000}"
  case "$code" in
    200|401|403) ok "NetBox reachable at ${NETBOX_URL%/} (HTTP $code)" ;;
    000)         warn "could not reach ${NETBOX_URL%/} — on the VPN?" ;;
    *)           warn "NetBox returned HTTP $code from ${NETBOX_URL%/}/api/status/" ;;
  esac
fi

if [ "$MODE" = "check" ]; then
  printf '\n%sAll dependency checks passed.%s\n' "$GRN" "$RST"
  exit 0
fi

# ---------------------------------------------------------------------- build

head_ "Building"
cd "$REPO_DIR"

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run build

if [ -f dist/index.js ]; then
  ok "built $REPO_DIR/dist/index.js"
else
  bad "build finished but dist/index.js is missing"
  exit 1
fi

# ------------------------------------------------------------------ smoke test

head_ "Smoke test"
TOOL_COUNT="$(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"install.sh","version":"1"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | NETBOX_URL="${NETBOX_URL:-https://smoke-test.invalid}" \
    NETBOX_TOKEN="${NETBOX_TOKEN:-smoke-test}" \
    node dist/index.js 2>/dev/null \
  | tail -1 \
  | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["result"]["tools"]))' 2>/dev/null || echo 0
)"

if [ "$TOOL_COUNT" -gt 0 ]; then
  ok "server responds to tools/list — $TOOL_COUNT tools registered"
else
  bad "server did not respond to tools/list"
  note 'run manually to see the error:  node dist/index.js --help'
  exit 1
fi

# ---------------------------------------------------------------- config output

CLAUDE_CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

head_ "Client configuration"
cat <<EOF
Add this to Claude Desktop's config, replacing the two placeholder values:

  $CLAUDE_CFG

{
  "mcpServers": {
    "netbox": {
      "command": "$NODE_BIN",
      "args": ["$REPO_DIR/dist/index.js"],
      "env": {
        "NETBOX_URL": "https://netbox.yourcompany.com",
        "NETBOX_TOKEN": "PASTE_YOUR_TOKEN_HERE",
        "NETBOX_READONLY": "1"
      }
    }
  }
}

Then fully quit Claude Desktop (Cmd-Q) and reopen it.

  NETBOX_READONLY=1  omits every create/update/delete tool. Remove it only if
                     you are supposed to modify NetBox records.
  NETBOX_TOOL_GROUPS narrows the tool surface further — see AGENTS.md § 10.

For Codex CLI, Cursor, or Claude Code, see AGENTS.md § 6.
EOF

# ------------------------------------------------- optional: merge into config

if [ "$WRITE_CLAUDE" = 1 ]; then
  head_ "Writing Claude Desktop config"

  if [ -z "${NETBOX_URL:-}" ] || [ -z "${NETBOX_TOKEN:-}" ]; then
    bad "--write-claude-config needs NETBOX_URL and NETBOX_TOKEN exported first"
    note 'example:'
    note '  export NETBOX_URL=https://netbox.yourcompany.com'
    note '  export NETBOX_TOKEN=your-token'
    note "  ./scripts/install.sh --write-claude-config"
    exit 1
  fi

  mkdir -p "$(dirname "$CLAUDE_CFG")"
  if [ -f "$CLAUDE_CFG" ]; then
    BACKUP="$CLAUDE_CFG.bak.$(date +%Y%m%d%H%M%S)"
    cp "$CLAUDE_CFG" "$BACKUP"
    ok "backed up existing config to $BACKUP"
  fi

  # Default to read-only unless the caller explicitly set NETBOX_READONLY.
  # Set NETBOX_READONLY=0 for a read/write install.
  CFG_PATH="$CLAUDE_CFG" NODE_BIN="$NODE_BIN" REPO_DIR="$REPO_DIR" \
  NETBOX_READONLY="${NETBOX_READONLY:-1}" python3 <<'PY'
import json, os, sys

path = os.environ["CFG_PATH"]
try:
    with open(path) as fh:
        cfg = json.load(fh)
except FileNotFoundError:
    cfg = {}
except json.JSONDecodeError as exc:
    sys.exit(f"existing config is not valid JSON ({exc}); fix or move it first")

if not isinstance(cfg, dict):
    sys.exit("existing config is not a JSON object; fix or move it first")

env = {
    "NETBOX_URL": os.environ["NETBOX_URL"],
    "NETBOX_TOKEN": os.environ["NETBOX_TOKEN"],
}
for opt in ("NETBOX_READONLY", "NETBOX_TOOL_GROUPS", "NETBOX_INSECURE"):
    val = os.environ.get(opt)
    if val and val not in ("0", "false", "no", "off"):
        env[opt] = val

cfg.setdefault("mcpServers", {})["netbox"] = {
    "command": os.environ["NODE_BIN"],
    "args": [os.path.join(os.environ["REPO_DIR"], "dist", "index.js")],
    "env": env,
}

with open(path, "w") as fh:
    json.dump(cfg, fh, indent=2)
    fh.write("\n")

# This file now contains an API token. Default umask leaves it world-readable.
os.chmod(path, 0o600)

mode = "read-only" if env.get("NETBOX_READONLY") else "READ/WRITE"
print(f"  wrote 'netbox' server into {path}")
print(f"  mode: {mode}" + ("" if env.get("NETBOX_READONLY")
      else "  <-- create/update/delete tools ARE enabled"))
print(f"  servers now configured: {', '.join(sorted(cfg['mcpServers']))}")
PY

  if python3 -m json.tool < "$CLAUDE_CFG" > /dev/null 2>&1; then
    ok "config is valid JSON"
  else
    bad "config is NOT valid JSON after writing — restoring the backup"
    if [ -n "${BACKUP:-}" ] && [ -f "${BACKUP:-}" ]; then
      cp "$BACKUP" "$CLAUDE_CFG"
      note "restored from $BACKUP"
    else
      note "no backup existed; remove $CLAUDE_CFG and re-run"
    fi
    exit 1
  fi
  warn "fully quit Claude Desktop (Cmd-Q) and reopen it to pick this up"
fi

printf '\n%s%sDone.%s\n' "$BOLD" "$GRN" "$RST"

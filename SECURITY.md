# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security vulnerability.

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/zenixsolutions/netbox-mcp-server/security/advisories/new)
on this repository. Include:

- what the vulnerability allows an attacker to do
- the steps to reproduce it
- the version or commit you tested against

We aim to acknowledge reports within a few business days. This is a small project
maintained alongside other work — please be patient, and we will keep you updated on
progress toward a fix.

## Scope

In scope:

- Leakage of the `NETBOX_TOKEN` into logs, tool responses, error messages, or files
- Any path by which a tool call reaches a NetBox endpoint the caller did not intend
- Bypass of `NETBOX_READONLY` or `NETBOX_TOOL_GROUPS` gating
- Injection through tool arguments into the constructed HTTP request
- Dependency vulnerabilities that are reachable from this code

Out of scope:

- Vulnerabilities in NetBox itself — report those to
  [NetBox](https://github.com/netbox-community/netbox/security/policy)
- Vulnerabilities in an MCP client (Claude Desktop, ChatGPT, Cursor, …)
- An LLM choosing to call a destructive tool it was given access to. That is a
  configuration decision, not a vulnerability — see "Operating this safely" below.
- Anything requiring an attacker to already have write access to the user's machine

## Operating this safely

This server is a bridge between a language model and your infrastructure source of
truth. A few properties are worth understanding before you deploy it.

**The NetBox token is the real security boundary.** `NETBOX_READONLY` and
`NETBOX_TOOL_GROUPS` control which tools are registered — they keep destructive
capabilities out of the model's reach and out of its context window, which is genuinely
useful. But they are client-side. If you need a guarantee that a given user cannot write
to NetBox, issue them a **read-only token in NetBox itself**, with object permissions
scoped to what they should see. Then use `NETBOX_READONLY=1` on top of it.

**Deletes cascade and cannot be undone.** NetBox removes dependent objects: deleting a
device removes its interfaces, power ports, and assigned IPs; deleting a site can remove
its racks, devices, and prefixes. The `deletes` group is opt-in under
`NETBOX_TOOL_GROUPS` for this reason, and absent entirely under `NETBOX_READONLY`.

**Prompt injection is a real risk with write access.** Object descriptions, comments, and
custom fields in NetBox are attacker-influenceable in some environments, and a model that
reads them may be steered by their contents. If any of your NetBox data originates from
outside your organization, treat write access as high-risk and prefer read-only tokens.

**Tokens live in client config files.** `~/Library/Application Support/Claude/
claude_desktop_config.json` and its equivalents are plaintext, and are created with the
default umask — usually world-readable. `chmod 600` them, and delete any `.bak` copy you
make while editing: a backup is a second copy of every token in the file, it inherits the
original's permissions, and nothing cleans it up. Set an expiry on every token, scope
tokens to the office IP range if your NetBox deployment supports it, and rotate them when
someone leaves — and remember that rotating a token does not help if an old copy of the
config still holds the previous one.

**`NETBOX_INSECURE=1` disables TLS certificate validation entirely**, which exposes the
token to anyone able to intercept the connection. Prefer installing your internal root CA
into the system trust store.

## Supported versions

Fixes land on `main` and go out in the next release. There is no long-term support
branch: upgrade to the latest published version of `@zenixsolutions/netbox-mcp` (or, if
you run from a clone, pull `main` and rebuild). If your client config pins a version,
bump the pin — a pinned `npx` invocation never picks up a fix on its own.

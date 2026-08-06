# Compatibility

What works where, stated honestly. If something below is wrong, that is a bug —
please open an issue.

## Runtime

|           | Supported                                                         |
| --------- | ----------------------------------------------------------------- |
| Node.js   | 20.11 LTS and newer. Node 18 is end-of-life and is not supported. |
| Platforms | macOS, Linux, Windows. CI runs Linux only.                        |
| Transport | **stdio only.**                                                   |

## MCP clients

| Client             | Status            | Notes                                                       |
| ------------------ | ----------------- | ----------------------------------------------------------- |
| Claude Desktop     | Supported         | Launched as a subprocess over stdio.                        |
| Claude Code        | Supported         |                                                             |
| Cursor             | Expected to work  | stdio server, no client-specific behaviour. Untested by us. |
| Codex              | Expected to work  | Untested by us.                                             |
| ChatGPT connectors | **Not supported** | Requires a remote HTTP transport.                           |
| Grok connectors    | **Not supported** | Same reason.                                                |

A remote transport is not planned for `0.1.x`. Until it exists, this server
cannot be used by any client that only speaks HTTP.

## NetBox

|                         |                                                                         |
| ----------------------- | ----------------------------------------------------------------------- |
| Contract-tested against | **NetBox 4.6.0**, with `netbox_inventory` 2.6.0. 435 checks, 0 defects. |
| Known-good range        | 4.6.0 only. See below — one version is not a range.                     |
| Authentication          | API token, `Authorization: Token <token>`.                              |

**Response shapes differ across NetBox versions.** One instance has been tested.
Please include your NetBox version in any bug report.

### Establishing the supported range

The contract suite has run against exactly one live instance: NetBox 4.6.0 with
the `netbox_inventory` plugin. **All 138 derived object types answered 200, and
the run recorded no defects.** The report is committed at
[`docs/reference/spec-defects.md`](./reference/spec-defects.md).

**One instance is evidence, not a range.** Every object type, field, filter and
enum this server offers is derived at runtime from the connected instance's own
`/api/schema/`. That derivation was first written against a committed NetBox
4.6.7 schema document, and the 4.6.0 run then corrected four things the document
had left wrong — an invalid token answering 403 rather than 401, unknown query
parameters being silently ignored rather than rejected, an HTML body on a 404,
and a malformed object-type key. There is no reason to assume a different
version behaves the same.

If you run it and it passes on a version not listed here, that is exactly the
evidence needed to widen this row.

Run it against your instance:

```sh
git clone https://github.com/ZenixSolutions/netbox-mcp-server.git
cd netbox-mcp-server && npm ci
NETBOX_URL=https://netbox.example.com \
NETBOX_TOKEN=<a token with write_enabled = false> \
npm run test:contract
```

- **The token must be read-only.** The suite sends exactly one create and one
  delete, solely to observe how they are refused, and it aborts before running
  anything if it can prove the token is able to write. See
  [`tests/contract/README.md`](../tests/contract/README.md) for the three
  independent guards.
- It is **opt-in**: `npm test` does not run it, and without `NETBOX_URL` /
  `NETBOX_TOKEN` it skips with an explanation instead of failing.
- It makes a few hundred read requests plus one 6-13 MB schema fetch.
- Whatever the outcome, it writes
  [`docs/reference/spec-defects.md`](./reference/spec-defects.md) and prints the
  same content to the console between
  `===== NETBOX CONTRACT REPORT BEGIN =====` and
  `===== NETBOX CONTRACT REPORT END =====`. **Please paste that block into an
  issue**, with or without defects — a clean run on a version not listed here is
  exactly the evidence needed to widen the range, and a failing one is the bug
  report.

The hostname is redacted from the report unless you set
`NETBOX_CONTRACT_INCLUDE_HOST=1`.

### Plugins

`netbox-inventory` (assets, suppliers, purchases, deliveries) has tools
registered for it. They fail with a 404 from NetBox if the plugin is not
installed on your instance.

**`netbox_inventory` 2.6.0 is verified; other plugins are not.** The stock
schema document NetBox generates has no plugins installed, so `/api/plugins/**`
appears nowhere in it and none of the derivation was exercised against a plugin
serializer until a live run. Against 4.6.0 with `netbox_inventory` 2.6.0, all 31
plugin paths classified correctly and all 12 plugin object types resolved their
write schemas — including the four that need the `Writable<Model>Request` form.

That is one plugin. A plugin that names its endpoints differently, or nests them
more deeply, has never been tried. `netbox_global_search` also still names
`plugins/inventory/assets` as a fixed target rather than deriving it, so global
search will attempt that endpoint on an instance without the plugin.

## Known limitations

- **No remote HTTP transport.** See the client table above.
- **A write costs several calls.** The layered design trades round-trips for
  context. Measured against a live instance: a trivial read is 1 call, and
  creating a device with three prerequisites is 6, five of them before the
  write. See [`docs/reference/eval-results.md`](./reference/eval-results.md).
  In exchange, `tools/list` is ~3,000 tokens rather than the ~180,000 the
  previous one-tool-per-operation surface cost.
- **Whether a model picks the right path is unmeasured.** The eval set measures
  the reference path; three of its ten tasks need a human or an LLM judge to
  decide whether a model behaved correctly, and that has not been done.
- **`device_id` versus `device`.** Tools that attach an object to a device
  expose the argument as `device_id`, not `device`, and rename it before the
  request. Anthropic's remote-devices bridge reserves the top-level argument
  name `device` for its own routing and strips it before the call reaches this
  server. If you are not going through that bridge, the rename is invisible —
  but the argument name in the schema is still `device_id`.
- **`NETBOX_INSECURE=1` disables TLS verification entirely**, which exposes the
  token to anyone able to intercept the connection. Prefer installing your
  internal root CA into the system trust store.
- **File uploads and NetBox's GraphQL API are not implemented.**

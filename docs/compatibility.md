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

|                 |                                                                     |
| --------------- | ------------------------------------------------------------------- |
| Tested against  | _Not yet contract-tested against any live instance — see issue #4._ |
| Minimum version | Not yet established.                                                |
| Authentication  | API token, `Authorization: Token <token>`.                          |

**Response shapes differ across NetBox versions.** Until the contract suite in
issue #4 runs, treat the supported-version range as unknown rather than wide.
Please include your NetBox version in any bug report.

### Plugins

`netbox-inventory` (assets, suppliers, purchases, deliveries) has tools
registered for it. They fail with a 404 from NetBox if the plugin is not
installed on your instance.

## Known limitations

- **No remote HTTP transport.** See the client table above.
- **The tool surface is very large.** 446 tools by default; a `tools/list`
  response is roughly 180,000 tokens. This is tracked as issue #3 and is the
  subject of RFC-003.
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

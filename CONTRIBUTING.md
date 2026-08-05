# Contributing

Thanks for taking a look. Issues and pull requests are welcome.

**Security issues do not belong here** — see [SECURITY.md](SECURITY.md) for private
reporting.

## Getting set up

Node.js >= 20.11 is required (`engines.node` in `package.json`; CI runs 20 and 22).

```bash
git clone https://github.com/zenixsolutions/netbox-mcp-server.git
cd netbox-mcp-server
npm ci
npm run build
```

Run `npm ci` in a shell with no `NETBOX_TOKEN` exported — it runs the install scripts of
every package in the dependency tree, and each one inherits your environment.

To iterate:

```bash
npm run dev     # tsx watch src/index.ts
```

You need a NetBox instance to test against. The public
[NetBox demo](https://demo.netbox.dev/) works for read-only exploration; for anything
involving writes, run NetBox locally with Docker rather than pointing at production.

## Before opening a pull request

```bash
npm run typecheck      # tsc --noEmit over sources and tests
npm run lint           # eslint
npm run format:check   # prettier --check; `npm run format` fixes
npm test               # vitest run
npm run build          # must pass with no TypeScript errors
npm audit              # should report 0 vulnerabilities
```

And confirm the tool surface still registers as expected:

```bash
node dist/index.js --list-tools | wc -l                     # -> 446
NETBOX_READONLY=1 node dist/index.js --list-tools | wc -l   # -> 179
```

If your change alters the tool count, update the numbers in `README.md` and
`AGENTS.md` § 10 to match. Those tables are checked against real output, not estimated —
please keep them that way.

## Adding a resource

Most resources need no new plumbing. In the relevant `src/tools/*.ts`:

1. Define a `ResourceDescriptor` — endpoint, singular, plural, description, and the
   fields to surface in list and detail views.
2. Define the Zod shapes for the list filters and the create/update body.
3. Call `registerList` / `registerGet` / `registerCreate` / `registerUpdate` from
   `src/registrars.ts`.
4. Add `[endpoint, singular]` to the `RESOURCES` array in `src/tools/deletes.ts` so the
   resource gets a delete tool too.

Adding a whole new **group** additionally requires adding its name to `ALL_TOOL_GROUPS`
in `src/gating.ts` and an entry in the `REGISTRARS` table in `src/server.ts`. Forgetting
the first means `NETBOX_TOOL_GROUPS` silently cannot select it; forgetting the second
means the group is never registered. `src/index.ts` is argv parsing only — nothing is
wired there.

## Conventions

- Tool descriptions are the model's only documentation — write them for an LLM that has
  never seen NetBox. Say what the tool does, when to use it instead of a neighbouring
  tool, and what the arguments mean in NetBox's terms.
- Destructive tools must carry `destructiveHint: true` and spell out what cascades.
- Never log, echo, or interpolate `NETBOX_TOKEN` into a response or error string.
- Keep responses under the `CHARACTER_LIMIT` in `src/constants.ts`; use the pagination
  helpers in `src/formatting.ts` rather than truncating by hand.
- No new runtime dependencies without a good reason. The dependency surface is
  deliberately small: the MCP SDK, axios, and zod.

## Documentation changes

`AGENTS.md` is written to be executed by an AI assistant, not skimmed by a person. When
editing it, keep steps imperative and unambiguous, state the expected output of every
command, and give the fix inline rather than deferring to "consult the docs." If you find
a step that caused an assistant to guess or improvise, that is a bug worth reporting even
without a fix attached.

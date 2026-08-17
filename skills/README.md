# Skills

Agent skills that ship with this MCP server. They live here, in the same
repository as the tools they drive, and they are versioned with the tool
contract.

## Why they are in this repository

The `netbox-modeling` skill used to be an account-level skill on one machine,
maintained separately from the server. When RFC-003 replaced 446 typed tools
with five layered ones, **every tool name the skill referenced ceased to
exist**. The skill did not degrade — it broke completely, and nothing in either
artifact could have caught it, because the two were not versioned together.

That is the whole argument. A skill that names tools is part of the tool
contract:

- A change to the tool surface is a change to the skill. Both land in the same
  pull request, so the review sees the pair.
- Claims about tool behaviour are checkable against `src/tools/layered/` in the
  same tree, and against the live findings in
  `docs/reference/spec-defects.md`. A skill maintained elsewhere drifts, and the
  drift is silent until a model acts on it.
- The skill is the basis of the eval set (RFC-003 D7). Evals against a skill
  that lives somewhere else measure a moving target.

RFC-003, Open Question 3, records this decision.

## `netbox-modeling`

Turns a human request ("rack this switch and cable it") into the right sequence
of `netbox_discover` → `netbox_describe` → `netbox_read`/`netbox_write` calls.

| File                             | Contents                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| `SKILL.md`                       | The loop, the golden rules, and the conventional build order         |
| `references/tool-surface.md`     | Exact argument shapes, filters, pagination, round-trip economics     |
| `references/build-order.md`      | Per object type: required fields, enums, references, version traps   |
| `references/modular-hardware.md` | Module bays, modules, `{module}` substitution, breakouts, line cards |
| `references/deprecations.md`     | What NetBox still accepts but nothing should write                   |
| `references/workflows.md`        | Playbooks: cabling, device intake, IPAM, bulk creation, deletion     |
| `references/conventions.md`      | Defaults worth recommending: naming, statuses, types, IP hygiene     |

The reference files are progressive disclosure: `SKILL.md` is always loaded, the
rest are read on demand for the task at hand.

## Packaging

```sh
npm run build:skill
```

Writes two artifacts into `dist/skills/`, both from the same source tree, so
they cannot disagree:

| Artifact                | What it is                                                                                     | Where it goes                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `netbox-modeling.skill` | A zip of `skills/netbox-modeling/`, entries prefixed with the skill's own directory name       | A client that installs a skill folder                             |
| `netbox-modeling.md`    | Every markdown file flattened into one document, cross-references rewritten to in-page anchors | A surface that takes a single knowledge file rather than a folder |

The build prints the byte size of each, so a release can see at a glance whether
one of them ballooned. The packager is dependency-free (`node:zlib` plus a
minimal zip writer) and takes an optional `--out-dir`:

```sh
node scripts/build-skill.mjs --out-dir /tmp
```

Neither artifact is needed on the Claude surface: the plugin at
`.claude-plugin/` bundles this directory directly. See
[`docs/installing-the-skill.md`](../docs/installing-the-skill.md) for the
per-surface install.

## Maintaining a skill here

- **Check every claim about a tool against `src/tools/layered/`.** Do not
  document an argument that does not exist. The tools' own descriptions are the
  contract.
- Skill instructions are read by a model, not a person: be concrete and
  imperative, and prefer an exact field name to a description of one.
- Keep `SKILL.md` short enough to stay loaded, and push detail into
  `references/`.
- When a tool's arguments, defaults or error behaviour change, update the skill
  in the same change and note it in `CHANGELOG.md`.

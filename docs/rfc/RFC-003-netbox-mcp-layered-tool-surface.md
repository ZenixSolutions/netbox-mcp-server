# RFC-003: NetBox MCP Server — Engineering OS Adoption and a Layered Tool Surface

- **Status:** **Approved** by the Project Owner, 2026-08-05
- **Author:** Claude (acting as Repository Architect / API-MCP Architect / Security Engineer per `ACTIVATION_MATRIX.md`)
- **Date:** 2026-08-05
- **Repository:** `ZenixSolutions/netbox-mcp-server` (public, MIT, one squashed commit `c4a3944`)
- **Related:** `RFC-001` (Lumics MCP foundation), `claude/hudu-mcp-build-status.md`, `claude/hudu-mcp-release-playbook.md`, `bootstrap/issues/008-first-external-adoption.md`
- **Reviewers:** See "Recorded exception — independent review" below
- **Owner decision:** Approved 2026-08-05. D1–D8 adopted; all open questions resolved.

---

## Summary

`netbox-mcp-server` is a working, unpublished TypeScript MCP server for the NetBox REST API. It is the third MCP repository to come under Engineering OS governance, after Lumics (RFC-001) and Hudu (RFC-002).

It has one disqualifying defect and a set of ordinary conformance gaps.

**The disqualifying defect is measured, not estimated.** The server registers **446 tools**. A `tools/list` response is **720,863 characters — roughly 180,000 tokens**. That does not fit in a 200k-token context window before the user has said anything. With `NETBOX_READONLY=1` it is still **179 tools and ~82,000 tokens**, which consumes 40% of the window as a precondition of connecting.

This RFC proposes replacing the one-tool-per-operation surface with the **layered tool pattern** — discovery, planning, execution — driven by NetBox's own OpenAPI schema, and bringing the repository to `standards/repository-standard.md` in full.

Four decisions have already been made by the Project Owner and are recorded here as approved inputs, not open questions:

| Decision            | Owner selection                                                   |
| ------------------- | ----------------------------------------------------------------- |
| Scope               | Full Engineering OS adoption, same path Hudu took                 |
| API coverage        | The whole NetBox API, restructured into layers                    |
| Write safety        | No environment gates — the NetBox API token decides               |
| Distribution        | Public repo under `ZenixSolutions`, npm, per the release playbook |
| Ergonomic shortcuts | Keep a global-search tool alongside the layers                    |
| Schema source       | Fetch the live instance's `/api/schema/` at runtime               |
| Identity            | Reset to `0.1.0`, publish as `@zenixsolutions/netbox-mcp`         |

---

## Problem

Three things are wrong at once, and only the first is unusual.

1. **The tool surface cannot be loaded.** 446 tools is not a usability problem; it is a hard failure. It also fails `standards/ai-interface-standard.md` on its own terms — a model cannot choose correctly on the first attempt among 446 options with near-identical descriptions, and the Hudu build notes already flag 70 as an open usability risk.

2. **The repository is unratified.** No tests, no lint, no CI, no CHANGELOG, no CODE_OF_CONDUCT, no issue or PR templates, no `docs/` tree, no dependency policy, no branch protection, and a single squashed commit with no history. `standards/repository-standard.md` requires every one of these.

3. **Several decisions diverge from RFC-001 without a recorded exception.** Node ≥18 (end-of-life) where RFC-001 chose ≥20 LTS; axios where RFC-001 chose native `fetch`; `main` pointing at an executable, which RFC-001 D2 explicitly forbids.

---

## Goals

- A tool surface that fits comfortably in context and that a model can navigate correctly on the first attempt.
- Complete coverage of the documented NetBox API — DCIM, IPAM, virtualization, circuits, tenancy, VPN, wireless, extras — plus whatever plugins the target instance has installed, without paying per-endpoint context cost.
- `standards/repository-standard.md` met in full, and credibility to external contributors.
- A security posture that survives public scrutiny, per `standards/security-standard.md`.
- A recorded gap report feeding Engineering OS v0.2, per Milestone 6.

## Non-Goals

- Remote HTTP transport. stdio for `0.1.0`, matching Hudu; ChatGPT and Grok connectors remain out of reach and this must be stated honestly in `docs/compatibility.md`.
- Environment-variable write gating. Owner decision: the NetBox token's `write_enabled` flag and object permissions are the control, and they are enforced upstream where an agent cannot reach them. This is a _stronger_ posture than Hudu's env gates, not a weaker one — but it makes the token-scoping guidance in the README load-bearing.
- Undocumented API surface. `CONSTITUTION.md` Article IV.

---

## Current State

**Measured**, by building the repository and completing a real MCP `initialize` + `tools/list` handshake over stdio:

| Configuration       | Tools |              `tools/list` size |
| ------------------- | ----: | -----------------------------: |
| Default             |   446 | 720,863 chars ≈ 180,000 tokens |
| `NETBOX_READONLY=1` |   179 |  329,306 chars ≈ 82,000 tokens |

4,953 lines of TypeScript across 22 files. `tsc` passes. 153 registrar calls across 13 tool modules generate the surface from a shared factory in `src/registrars.ts` — the code is not badly written, it is correctly written against a design that does not scale.

### Defects and gaps found in audit

**Architecture**

| #   | Finding                                                                                                         | Consequence                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A1  | 446 tools, ~180k tokens of `tools/list`                                                                         | Server cannot be loaded alongside any real workload                                     |
| A2  | `main` and `bin` both point at `dist/index.js`, which has a shebang and calls `main()` as an import side effect | Importing the package starts a stdio server. Untestable in-process. Violates RFC-001 D2 |
| A3  | `SERVER_VERSION` hardcoded in `src/index.ts`, duplicated from `package.json`                                    | Version drift between what npm says and what the server reports                         |
| A4  | `server.registerTool` cast to `(...a: unknown[]) => unknown`, every handler takes `args: any`                   | SDK typing defeated repository-wide; Zod shapes are not connected to handler types      |
| A5  | Node ≥18 (EOL), axios rather than native `fetch`                                                                | Diverges from RFC-001 D1 with no recorded exception                                     |

**Security**

| #   | Finding                                                                                          | Consequence                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `client.raw()` accepts a caller-supplied path with no confinement to the `/api` prefix           | Currently only called internally, so not exploitable today — but it becomes the execution layer's entry point, which is exactly where Hudu's `buildPath` traversal defect lived. Must gain prefix confinement before it is exposed |
| S2  | `extractNetBoxMessage` iterates every key of an upstream error body and returns it verbatim      | Same class as Hudu's "unstripped upstream error bodies". NetBox 400 responses echo submitted values, so anything written into a custom field comes back out                                                                        |
| S3  | `NETBOX_INSECURE` disables TLS verification globally, with no warning emitted and no scope limit | Silent MITM exposure. Needs a loud stderr warning, README documentation, and a recorded residual risk                                                                                                                              |
| S4  | `loadConfig` validates URL _shape_ only — any scheme is accepted, including plain `http:`        | Token transmitted in clear text with no warning                                                                                                                                                                                    |
| S5  | `scripts/install.sh` is an AI-executable install runbook                                         | Any script an agent is instructed to run needs security review before the repository is public                                                                                                                                     |

**Correctness**

| #   | Finding                                                                                                             | Consequence                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `remapReservedArgs` unconditionally deletes `device_id` and renames it to `device`                                  | A bridge-specific workaround embedded in the core registrar. Tool schemas advertise a field name the API does not have. Silently drops `device_id` when `device` is also present |
| C2  | Tool input shapes are not `.strict()` except in `search.ts`; unknown args flow into `cleanParams` and out to NetBox | NetBox 400s on undocumented query parameters — the same behaviour Hudu exhibited. A hallucinated filter produces a confusing upstream error instead of a local one               |
| C3  | `validateStatus: (s) => s < 500` treats 3xx as success and casts `response.data` blindly                            | A redirect to a login page deserialises as a NetBox object                                                                                                                       |
| C4  | JSON list truncation uses a hardcoded 25,000-char limit that differs from the Markdown path's limit                 | Two different budgets for the same response                                                                                                                                      |

**Repository conformance** — required by `standards/repository-standard.md`, all absent: CODE_OF_CONDUCT, issue templates, PR template, CI validation, dependency policy, branch protection, release tagging policy, CHANGELOG, `docs/` tree, any test at all.

**Nothing has been verified against a live NetBox instance.** The Hudu build notes call live contract testing "the highest-value hour" and record 22 endpoints whose response envelope the captured spec got wrong. That work has not been done here.

---

## Proposed Design

### D1 — The layered tool surface

Replace 446 tools with **five**, in four layers. Layers 1 and 2 are pure metadata; only layer 3 talks to NetBox with intent.

**Layer 0 — `netbox_global_search`** _(kept, unchanged in spirit)_

Answers a different question from the layers: _find an instance_, not _find a type_. Fans a `q` query across the common resources in parallel. Without it, "the switch called sw-core-01" costs a discover → describe → execute round-trip every time.

**Layer 1 — `netbox_discover`** _(discovery)_

```
{ query?: string, family?: "dcim" | "ipam" | "virtualization" | ... }
→ [{ object_type: "dcim.device", label: "Device", endpoint: "dcim/devices",
     operations: ["list","get","create","update","delete"],
     summary: "A piece of hardware installed in a rack." }, ...]
```

Returns the object-type registry — every type the _connected instance_ supports, including plugins, derived from its `/api/schema/` paths. One line per type. The complete registry for a stock NetBox is a few thousand tokens; a `family` or `query` filter keeps a typical call far smaller.

**Layer 2 — `netbox_describe`** _(planning)_

```
{ object_type: "dcim.device", operation: "create" }
→ required fields, optional fields with types and enum choices,
  read-only fields, accepted list filters, and the object types that
  must exist first (site, device_type, role)
```

Generated from the instance's OpenAPI component schemas and filterset parameters. This is the layer that makes the pattern defensible for NetBox specifically: **the API self-describes, so layer 2 is generated rather than hand-maintained, and cannot drift from the instance the way a hand-written tool schema can.** Hudu had no equivalent, which is why Hudu got typed tools and 22 spec defects.

**Layer 3 — `netbox_read` and `netbox_write`** _(execution, split)_

```
netbox_read  { object_type, operation: "list"|"get", id?, filters?, limit?, offset?, response_format? }
netbox_write { object_type, operation: "create"|"update"|"delete", id?, data?, confirm? }
```

Two tools rather than one, deliberately. MCP tool `annotations` — `readOnlyHint`, `destructiveHint`, `idempotentHint` — are static per tool. A single `netbox_execute` would have to declare itself destructive always, and hosts that gate on those hints would prompt on every read. Splitting keeps the annotations honest at a cost of exactly one extra tool.

**Security-critical:** neither tool accepts a path. `object_type` is resolved through the registry to an endpoint. There is no argument through which a caller can reach an arbitrary URL, which closes S1 by construction rather than by validation.

`netbox_write` validates `data` against the layer-2 schema **before** the request leaves the process, and on failure returns the layer-2 description in the error — so a wrong call self-heals in one round-trip instead of bouncing off a NetBox 400.

**Result:** 446 tools → 5. `tools/list` ~180,000 tokens → ~2,500.

### D2 — Delete confirmation

NetBox cascades deletes. Deleting a site can remove its racks, devices and prefixes. The current `netbox_delete_*` description leans on the model to confirm; a description is not a control.

Proposed: `netbox_write` with `operation: "delete"` requires `confirm` to equal the object's current `display` value, which the caller must have fetched. A mis-targeted id fails locally instead of cascading. _Marked as an open question — it is friction, and the owner may prefer to rely on token permissions alone._

### D3 — Schema acquisition

Fetch `/api/schema/?format=json` on first `describe` or `write`, not at startup — a read-only session that only lists devices should not pay for it. Cache in memory for the process, and on disk under `$XDG_CACHE_HOME/netbox-mcp/` keyed by the instance's NetBox version from `/api/status/`.

The document is several megabytes. **It is parsed in-process and never returned to the model.** Layer 1 and layer 2 emit derived summaries only.

Failure path: if `/api/schema/` is unreachable or restricted, the server degrades to a bundled minimal registry covering core DCIM/IPAM and says so in the tool result rather than failing silently.

### D4 — Language, runtime, tooling

Aligned with RFC-001 D1, correcting the divergences:

| Decision       | Proposal                                                           | Change from today   |
| -------------- | ------------------------------------------------------------------ | ------------------- |
| Node           | ≥ 20 LTS                                                           | was ≥18 (EOL)       |
| HTTP           | native `fetch`                                                     | drops axios         |
| TypeScript     | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | adds the latter two |
| Lint / format  | ESLint flat config + Prettier                                      | none today          |
| Tests          | Vitest, HTTP mocked at the transport boundary                      | none today          |
| Validation     | Zod at every tool boundary, `.strict()` everywhere                 | partially today     |
| Handler typing | no `any`, no cast on `registerTool`                                | fixes A4            |

### D5 — Repository layout

```
src/
  index.ts          # thin bin: shebang, arg parse, delegate — no side effects on import
  server.ts         # buildServer(), exported for in-process testing
  transport/        # stdio.ts
  api/              # typed NetBox client: confined path building, auth, redaction
  schema/           # OpenAPI fetch, cache, and the derived object-type registry
  tools/            # the five tools
  presentation/     # output shaping and token-budget control
docs/
  rfc/ adr/ reference/ compatibility.md
tests/
.github/            # workflows, issue templates, PR template, dependabot.yml
```

CLI verbs matching Hudu, because they are how a published package gets verified: `--version`, `--check` (exit 78 without config, 0 with), `--list-tools`.

### D6 — Security posture

- S1 closed by construction (D1) plus a confined `buildPath` with a regression test.
- S2: error bodies scrubbed centrally before they reach a tool result, in the single place every tool passes through — the control Hudu proved by having its first fix be incomplete.
- S3: `NETBOX_INSECURE` emits a warning on every start and is documented as a residual risk.
- S4: warn on `http:`, refuse non-`http(s)` schemes.
- S5: `scripts/install.sh` reviewed before publication, or deleted — `npx` makes it largely redundant.
- Token guidance is now load-bearing: the README must show how to create a NetBox token with `write_enabled=false` and a constrained object-permission set, because that is the _only_ write control.

### D7 — Testing

Per `standards/testing-standard.md`: unit (registry resolution, path confinement, schema derivation, redaction), integration (mocked HTTP per layer), **contract (live, against the Zenix instance)**, security (path confinement, error scrubbing, TLS refusal), installation (the README's commands actually work), regression (one test per defect above).

Plus an **eval set** — ten realistic NetBox tasks with verifiable answers, committed. Hudu shipped without one and recorded it as an open item; the layered design makes it more necessary, not less, because tool selection is now a reasoning chain rather than a single choice.

### D8 — Identity, versioning, release

`0.1.0`, `@zenixsolutions/netbox-mcp`, MIT, `CODE_OF_CONDUCT.md` (Contributor Covenant). Nothing is published, so the reset costs nothing. Pre-1.0 is honest: the tool surface is about to change completely, and Article III's backward-compatibility weight should not bind until it has settled.

Release follows `claude/hudu-mcp-release-playbook.md` exactly — token first-publish, flip to public, configure the trusted publisher, delete the token — including the `dependabot.yml` grouping and the pinned npm major.

README must carry a prominent disclaimer of non-affiliation with NetBox Labs.

---

## Alternatives Considered

**Keep the typed tools, ship subsets via `NETBOX_TOOL_GROUPS`.** _Rejected._ The mechanism exists today and does not work: the smallest useful combination is still tens of thousands of tokens, the user must know which groups they need before they know what they want to do, and a task spanning DCIM and IPAM needs both. It converts a hard failure into a configuration burden.

**Prune to the ~80 most useful tools, Hudu-style.** _Rejected on owner instruction_ (full API coverage), and it would be a worse fit regardless: NetBox's value is precisely the long tail of object types, and any hand-chosen 80 becomes a maintenance argument with every user.

**A single `netbox_execute` tool.** _Rejected_ on annotation fidelity — see D1.

**Repair in place, incrementally.** _Partially adopted._ `src/registrars.ts`, `formatting.ts` and `errors.ts` carry real, reusable work and should be refactored rather than rewritten. The tool modules are generated surface and should be replaced by the registry.

---

## Honest Trade-offs

This design is the **opposite** of the one Hudu shipped, and the divergence should be recorded as a deliberate architectural decision rather than treated as an evolution of practice.

|                            | Typed tools (Hudu)                                                | Layered (proposed)                        |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| Validation                 | At tool-schema time; the client rejects bad calls before they run | At runtime, in our code                   |
| Round-trips to first write | 1                                                                 | 2–3                                       |
| Context cost               | Linear in endpoints                                               | Flat                                      |
| Drift risk                 | Hand-written schemas drift from the API                           | Generated from the instance; cannot drift |
| Host UX                    | Per-tool names and hints                                          | Five generic names                        |

The reason it is right here and was not right for Hudu is **A1 and the OpenAPI schema**. Hudu's 89 tools fit; NetBox's 446 do not. Hudu's spec was a wrong static document; NetBox's is served live by the instance. Both conditions have to hold for the layered pattern to beat typed tools, and both hold here.

The round-trip cost is real and should be measured, not assumed. The eval set in D7 is how we find out.

### Amendment, 2026-08-05 — it was measured, and the table above was optimistic

The eval set ran against a live NetBox 4.6.0. Full results in
`docs/reference/eval-results.md`; the ten tasks were chosen to probe where this
design is weakest, not where it looks good.

**The "2–3 round-trips to first write" figure in the table is wrong.** Measured,
calls before the first write are:

| Task                                           | Calls before the write | Total |
| ---------------------------------------------- | ---------------------: | ----: |
| Create a site with guessed field names         |                      0 |     2 |
| **Create a device with three prerequisites**   |                  **5** | **6** |
| Assign an IP to an interface                   |                      2 |     3 |
| Set a status the user named in their own words |                      0 |     2 |
| Delete with confirmation                       |                      1 |     4 |

A realistic create — the case the design exists to serve — costs **six calls**,
not two or three. The table is corrected here rather than quietly left standing.

What the run confirms in the design's favour: the self-healing claim holds.
Two tasks reached a correct write in two calls by writing wrong first and
recovering from the local rejection, which is cheaper than describing up front.
A trivial read costs exactly one call. Nine of ten tasks completed within
budget on the reference path.

What it does not settle, and the report says so: whether a _model_ picks these
paths. Three tasks need a human or an LLM judge, because the plausible wrong
paths — four calls to look up one device, three calls and ten thousand
characters of metadata to return one integer, or inventing a `netbox_changelog`
tool rather than saying the surface cannot do it — are choices, not mechanics.

The honest summary is that the context saving is enormous and certain
(180,000 tokens to 3,000), and the round-trip cost is larger than claimed and
concentrated in exactly the multi-prerequisite creates that real modelling work
consists of. That is a trade worth making at this tool count, and it is not the
free win the original table implied.

---

## Impact

**Security:** materially positive. S1 closes by construction, S2 gains a central control, S3/S4 gain warnings. New risk introduced: runtime validation replaces schema validation, so a bug in the registry is a bug in the security boundary. Mitigated by tests and by the fact that a token that cannot write cannot be made to write.

**Documentation:** full set per `standards/documentation-standard.md`. Limitations must name the absent HTTP transport, the round-trip cost, the schema-fetch dependency, and the `device_id` bridge remap (C1).

**Compatibility:** breaking, completely. Anyone using the current tool names — including the `netbox-modeling` skill in this workspace, which drives them directly — must be updated in the same change. **That skill is a required part of this work, not a follow-up.**

---

## Open Questions

**Resolved by the Project Owner, 2026-08-05:**

1. **Delete confirmation (D2)** — _Resolved: required._ `netbox_write` with `operation: "delete"` must receive `confirm` equal to the object's current `display` value.
2. **Git history** — _Resolved: accepted as-is._ `c4a3944` stands as the origin point; traceability begins with the first governed PR.
3. **`netbox-modeling` skill** — _Resolved: committed in this repository_, versioned with the tool contract, and used as the basis for the eval set.

**Still open:**

4. **`scripts/install.sh`** — review and keep, or delete in favour of `npx`?
5. **Coverage threshold** — Engineering OS sets none. RFC-001 raised the same question and it is still open. Propose 85% on `src/`, excluding transport wiring.

---

## Gap Report — input to Engineering OS v0.2

Per Milestone 6, gaps this adoption exposed in the framework itself:

1. **No standard governs tool-surface size or context budget.** A 446-tool server passes every current standard. `standards/ai-interface-standard.md` should set a measurable ceiling on `tools/list` cost and require it to be verified in CI.
2. **No standard requires live contract testing.** It is the highest-value activity identified across two adoptions and appears nowhere in `standards/testing-standard.md`.
3. **No standard covers evaluation of AI usability.** Both Hudu and this repository can prove tools _work_ and neither can prove a model _chooses correctly_.
4. **`standards/repository-standard.md` lists artifacts without acceptance criteria** — "CI validation" is satisfied by a workflow that runs `true`.
5. **Nothing defines how a repository records a divergence from a prior RFC.** This RFC diverges from RFC-001's tool-design approach; there is no prescribed mechanism for that other than prose.

---

## Recorded exception — independent review

`CONSTITUTION.md` requires independent review, and
`standards/repository-standard.md` requires review requirements on a governed
repository. Neither was met for this change, and that is recorded here rather
than papered over.

The repository has exactly one person with write access. Every pull request in
the `0.1.0` foundation was authored by Claude and approved by the Project
Owner, who is also the only available reviewer. There is no second human
reviewer, so "independent" in the constitutional sense was not achievable.

What was done instead, and what it is worth:

- **Adversarial agent review of `scripts/install.sh` and the documentation.**
  Found two High-severity defects the author and `shellcheck` both missed — a
  truthiness mismatch that reported `read-only` while registering 446 tools
  including 89 cascading deletes, and a world-readable backup containing the
  API token. This is the second project on which independent review found
  every security defect and the author found none.
- **Live contract testing against a real NetBox 4.6.0.** 433 checks. Found a
  403-not-401 error mapping, a silent filter-drop that would have handed
  models unfiltered collections, an unbounded HTML error body, and a
  malformed object-type key.
- **Mutation checks on the three load-bearing derivation rules.** Each was
  confirmed to break tests when removed.

None of that is a substitute for a second pair of human eyes on 34,000 lines.
This exception should be closed, not normalised: revisit when a second
reviewer with write access exists. The same condition is open on `hudu-mcp`
for `enforce_admins`.

Per `CONSTITUTION.md` Article I, silence is not approval — this exception is
stated explicitly so that it was approved rather than assumed.

---

## Recommendation

Approve D1–D8, resolve the five open questions, and record the divergence from RFC-001's typed-tool approach as an ADR. Sequence: repository conformance and CI first (so every subsequent change is gated), then the layered surface behind tests, then live contract testing, then independent review, then release.

Per `CONSTITUTION.md` Article I, silence is not approval.

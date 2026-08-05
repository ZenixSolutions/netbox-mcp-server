# Eval set — can a model actually use this surface?

`tests/` proves the five layered tools **behave correctly when called**. 245 tests,
and not one of them proves a model can **pick the right one**. That gap is the
number-one open item on the sibling Hudu server, and it is sharper here: RFC-003
replaced 446 typed tools with five layered ones, cutting `tools/list` from about
180,000 tokens to about 3,000, and paid for it with round-trips — a write now
costs `netbox_discover` -> `netbox_describe` -> `netbox_write` where the old
surface cost one call.

RFC-003 says of that trade: _"The round-trip cost is real and should be measured,
not assumed."_ This directory is the measurement.

The tasks were written to **embarrass the design**, not to confirm it. Eight
target a failure mode the design is most likely to fail on; two target the places
it is least defensible. A green run here is a weaker claim than it looks — read
["What this cannot score"](#what-this-cannot-score) before quoting one.

## Running it

```sh
NETBOX_URL=https://netbox.example.com \
NETBOX_TOKEN=<token> \
npm run eval
```

Without both variables every task is `describe.skip` with a banner, exactly as
`tests/contract/` does. `npm test` never runs this suite: `vitest.config.ts`
includes `tests/` only, and this suite has its own config.

| Variable                      | Effect                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `NETBOX_URL`, `NETBOX_TOKEN`  | Required. Absent -> everything skips.                                             |
| `NETBOX_INSECURE=1`           | Accept a self-signed certificate, as the server itself does.                      |
| `NETBOX_EVAL_ALLOW_WRITES=1`  | Opt in to sending the create steps. Off by default. See [Safety](#safety).        |
| `NETBOX_EVAL_INCLUDE_HOST=1`  | Record the hostname in the committed report. Off by default.                      |
| `NETBOX_EVAL_TRANSCRIPTS=<f>` | Score a model's own transcripts instead. See [Scoring a model](#scoring-a-model). |

Expect roughly forty read requests and one schema fetch. A token that can only
read is enough for everything except the opt-in write steps.

## Safety

**Strictly read-only by default, enforced in code rather than promised in prose.**
A `netbox_write` step must declare how it is harmless or the runner refuses to
run the task at all (`assertDeclared` / `assertReadOnlySafe` in
`runner/harness.ts`). There are exactly four declarations:

| Declaration              | What happens                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requiresLocalRejection` | The runner first runs `validateWriteData` — the same validator the tool runs. Only if it says the payload will be **refused before any HTTP request** is the call made. If the payload turns out to be valid on this instance, the call is **not** made and the task is recorded `unverified`.    |
| `safeBecause`            | The tool's own control flow refuses the call regardless of data — a `delete` with no `confirm`, or with a mismatched one, is rejected before any `DELETE` is issued.                                                                                                                              |
| `mutates`                | Simulated unless `NETBOX_EVAL_ALLOW_WRITES=1`. Simulation runs the same local validation and records whether the payload **would** have been accepted. With the flag set, the call is sent and the created object is deleted again by `cleanupCreated`; created objects are named `eval-probe-*`. |
| `simulateOnly`           | Never sent, under any flag. Used for the final delete in E06 and the update in E10: there is no flag under which deleting or altering a stranger's device is an acceptable thing for an eval to do.                                                                                               |

The token-capability probe from `tests/contract/harness.ts` is reused to record
in the report whether the token could write; unlike the contract suite this one
does not require a read-only token, because it does not depend on one for safety.

## The ten tasks

Defined in [`tasks.ts`](./tasks.ts). Each carries the request, the reference
sequence, the machine-checkable condition, a round-trip budget, and a note on
what it probes.

| Task  | Request                                                     | Failure mode probed  | Budget | Scoreable  |
| ----- | ----------------------------------------------------------- | -------------------- | ------ | ---------- |
| `E01` | Show me the interfaces on sw-core-01.                       | type-ambiguity       | 2      | assisted   |
| `E02` | Create a site called Eval Probe Site in our EMEA region.    | wrong-layer shortcut | 2      | mechanical |
| `E03` | Add a new switch called eval-probe-sw-01 in rack R1 at DC1. | dependency ordering  | 6      | mechanical |
| `E04` | Which devices are at the site called DC 1?                  | filter naming        | 3      | mechanical |
| `E05` | How many devices are there?                                 | trivial-read cost    | 1      | assisted   |
| `E06` | Delete the device eval-probe-sw-01.                         | delete confirmation  | 3      | mechanical |
| `E07` | List the purchases recorded in our inventory plugin.        | plugin object type   | 2      | mechanical |
| `E08` | Who changed device sw-core-01 last week?                    | impossible task      | 2      | human      |
| `E09` | Assign 192.0.2.77/32 to interface Gi0/1 on sw-core-01.      | generic foreign key  | 3      | mechanical |
| `E10` | Mark sw-core-01 as decommissioned.                          | enum value           | 2      | mechanical |

Two of these are ours rather than the brief's:

- **E09** is the largest hole in layer 2. IP assignment is a generic foreign key
  — a content-type string plus an id — and `refersTo` cannot express it, so
  `netbox_describe` cannot tell a model what value `assigned_object_type` takes.
  Every wrong form of it (`interface: 5`, `assigned_object: {...}`, `Interface`)
  passes local validation and fails at NetBox, which is the exact failure the
  local validation exists to prevent.
- **E10** is the recovery claim at its narrowest. The user says "decommissioned";
  NetBox's value is `decommissioning`. If the refusal does not hand back the
  legal values, the model is guessing, and the one-round-trip recovery claim is
  false for the commonest write there is.

The tasks address live objects (a device, a site, a rack) resolved once per run.
An instance that holds none of a needed type makes the task `unverified` rather
than failed — the same convention `tests/contract/` uses.

## What this scores automatically

Entirely mechanical, no opinion involved:

- **The tool exists.** Every tool a task or a transcript names is checked against
  a real `tools/list` from the real server.
- **The arguments are accepted.** Checked against the tool's advertised input
  schema, and the `object_type` against the instance's registry.
- **The reference path works.** Every step is executed against the live instance
  and its response checked — did the read succeed, does the describe declare the
  prerequisites, does the refusal quote the string that has to be echoed back.
- **A write payload assembled from `netbox_describe` alone is valid.** E03 and
  E09 build their payloads out of the describe response and nothing else, so a
  planning layer that under-describes fails rather than passing on the author's
  knowledge of NetBox.
- **The round-trip count.** Recorded per task, against the budget, and broken out
  as "calls before the first write" — the row RFC-003 puts at 2-3.

## What this cannot score

**No model is in the loop.** The runner executes the reference sequence; it does
not ask a model what sequence to use. So it cannot tell you:

- **Whether a model would choose that path.** E01's whole question is whether a
  model reaches for `netbox_global_search` or guesses an `object_type`. The
  runner establishes that the search path works. Which path a model takes needs a
  model.
- **Whether an answer is true.** Nothing reads a final answer back against the
  instance.
- **Whether a refusal was right.** E08 is impossible on this surface, and the
  runner proves it is impossible — no change-log object type exists and
  addressing one is refused. Whether a model then _says so_ rather than inventing
  `netbox_changelog` or answering from `last_updated` is a judgement, and it is
  the entire point of the task. E08 can never pass or fail here; it can only
  establish the ground truth a judge measures against.
- **Whether a longer path was reasonable.** Several tasks have more than one
  correct route. Over budget is a finding about the surface, not proof of a bad
  model.

Tasks are tagged `mechanical`, `assisted` or `human` for exactly this reason, and
the report prints an explicit "not settled by this run" section rather than
letting a green run imply more than it earned. **Do not add a task whose success
condition is a judgement and mark it `mechanical`.**

## Scoring a model

When you do have a model's transcript, `runner/score-transcript.ts` scores the
half that is mechanical:

```sh
NETBOX_URL=... NETBOX_TOKEN=... \
NETBOX_EVAL_TRANSCRIPTS=./my-run.json \
npm run eval
```

```json
[
  {
    "task_id": "E03",
    "model": "some-model-1.0",
    "calls": [
      { "tool": "netbox_discover", "arguments": { "query": "device" } },
      {
        "tool": "netbox_describe",
        "arguments": { "object_type": "dcim.device", "operation": "create" }
      }
    ],
    "final_answer": "…"
  }
]
```

It fails on things that are unambiguously wrong — a tool that does not exist
(the tell for E08), arguments the tool does not accept, an `object_type` this
instance lacks — reports the round-trip count against the budget, and prints an
`unscoreable` line for every question it is deliberately not answering. The
instance is optional: without it, tool names are still checked and the argument
and object-type checks are skipped.

## Output

`docs/reference/eval-results.md`, rewritten on every run and printed to the
console between `===== NETBOX EVAL REPORT BEGIN =====` and
`===== NETBOX EVAL REPORT END =====`. It carries, per task: the tool-call
sequence actually taken with its arguments, the round-trip count, whether the
success condition was met, and which step it first went wrong at — plus the
round-trip ledger and the "not settled by this run" section.

## Adding a task

1. Add an `EvalTask` to `tasks.ts`. Fill in `probes` and `plausibleWrongPath`
   honestly; they are what a human judge reads.
2. Write the steps so the interesting values come from the **responses**, not
   from your knowledge of NetBox. A task that hard-codes `role` as a field name
   is testing your memory, not the planning layer.
3. Set `judgement` to what is actually true, and `roundTripBudget` to what the
   design claims — not to what it turns out to cost. The gap is the finding.
4. Any `netbox_write` step must declare its safety. The runner refuses otherwise.

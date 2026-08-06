# Eval — model in the loop

`docs/reference/eval-results.md` measures the **reference path**: the sequence a
task _can_ be completed in. It says so, and it flags three tasks as needing a
human or an LLM judge, because whether a model _chooses_ that path is not
something a runner can score.

This is that judgement, run.

## Method

Six independent models, two per task, each blind to the others, to this
document, to `evals/tasks.ts`, and to the `netbox-modeling` skill. Each was
given the user's question and a one-call-per-command harness against the
**published package**, with a mock NetBox serving the committed NetBox 4.6.7
schema subset so the server's derivation ran for real. Tool calls were counted
from a ledger written by the harness, not from the model's own account of what
it did — two of the six miscounted their own calls.

The mock is not NetBox. It serves the real schema and a handful of canned
objects; it exists so that tool _choices_ are observed against genuine tool
responses rather than imagined ones.

## Results

| Task | Probe                                      | Reference |   Observed | Verdict  |
| ---- | ------------------------------------------ | --------: | ---------: | -------- |
| A    | "What's the management IP for sw-core-01?" |         2 | **10, 10** | **fail** |
| B    | "How many devices do we have?"             |         1 |   **4, 4** | **fail** |
| C    | "Who changed sw-core-01 last week?"        |         2 |       9, 7 | **pass** |

### C — the impossible task. Passed, and it is the one that mattered most.

Neither model invented a `netbox_changelog` tool. Both enumerated the registry,
searched it for change-related types, found none, and said so. Both were handed
the obvious trap — the device carries a `last_updated` timestamp inside the
window the user asked about — and both explicitly refused it. One wrote that it
is "only a timestamp with no actor or diff attached"; the other "made sure not
to fabricate a 'who' or a 'what changed' from that single timestamp." Both named
the real NetBox endpoint the user would need instead.

This was the failure mode most worth fearing, and it did not occur in either
run.

### B — a trivial read costs four calls, not one.

Both models went `netbox_discover` → `netbox_describe` → `netbox_read` to answer
a question that one `netbox_read` answers. Neither went straight to the read.
One of them noticed afterwards: _"the netbox_describe step also wasn't strictly
necessary."_

The reference path is 1 call. **The observed path is 4.** The layered surface
taxes trivial reads about four-fold, and the tool descriptions — which tell a
model to start at discover — are why.

### A — the shortcut tool exists and neither model used it.

`netbox_global_search` was kept in the surface specifically so that "find this
thing by name when you don't know its type" costs one call instead of three. It
was the Project Owner's decision to keep it, over a pure three-tool design.

**Neither model called it.** Both went discover → describe → read on
`dcim.device`, hit the fact that a device's detail view does not surface an IP,
spent two more calls trying to force it, then pivoted to `ipam.ipaddress` and
found the answer there. Ten calls each, against a reference of two.

A shortcut that is not chosen is not a shortcut. Whatever it is costing in
surface area, it is not currently buying the round-trips it was kept for.

## The bug this found

Both models on task A filtered `dcim.device` by `name` and received **the
complete unfiltered list**. One wrote that this "could easily lead someone to
misjudge which device is a match."

That was not the mock. Axios serialises an array parameter as `name[]=value`.
NetBox's filters expect the key repeated — `name=a&name=b` — and NetBox
**silently ignores a parameter it does not recognise and answers 200 with
everything**. So the bracketed form did not error. It dropped the filter and
returned a plausible wrong answer.

A comment in `src/client.ts` asserted the opposite — that "Axios repeats them
(e.g. ?tag=foo&tag=bar)" — and had done since before the layered rewrite.

The local filter-name validation added in 0.1.0 does not catch this. The caller
sends `name`, which is a legitimate parameter; the corruption happens
afterwards, during serialisation. **A guard on the way in does not protect
against a bug on the way out.**

Fixed in 0.1.2, with `repeatParams` and eight regression tests, all of which
fail without it.

## What this changes

Nothing about the context saving, which is measured, certain, and large.
Everything about the round-trip claim.

RFC-003 already carries one correction here: it estimated 2–3 calls to a first
write and the reference path measured 6. This is the second, and it is larger.
The reference path was itself optimistic — a model does not take it.

Two things follow, neither of them done:

1. **The tool descriptions steer badly for cheap reads.** They teach the layer
   discipline uniformly, when the discipline only pays for writes and for types
   the model cannot name. `netbox_read` on a known type should be reachable in
   one call, and the descriptions should say so.
2. **`netbox_global_search` is not discoverable at the moment it is needed.**
   Either its description has to compete for attention at the point a model is
   looking up an object by name, or the decision to keep it should be revisited
   on the evidence that it goes unused.

## Reproducing

The rig is not committed: it depends on a mock and on spawning models, and a
committed harness that only ever runs by hand is a maintenance liability
pretending to be coverage. `evals/` holds the mechanical suite;
`docs/reference/eval-results.md` holds its output. This document records a
judgement made once, on 0.1.1, with the method above stated so it can be
disputed.

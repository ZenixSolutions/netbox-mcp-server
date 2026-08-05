# Spec defects — NetBox live contract run

**This file has not been generated yet.** It is written by `npm run test:contract`
(`tests/contract/`), which has never been run against a live NetBox instance —
that is issue #4, and until it happens every claim in
[`netbox-schema-derivation.md`](./netbox-schema-derivation.md) is verified only
against a committed schema document, not against a running instance.

Generate it with:

```sh
NETBOX_URL=https://netbox.example.com \
NETBOX_TOKEN=<a token with write_enabled = false> \
npm run test:contract
```

The run overwrites this file with a table comparing, for every check, what this
codebase _derives_ from the instance's own `/api/schema/` against what the
instance _actually did_ when asked — including the checks that passed. The same
content is printed to the console between
`===== NETBOX CONTRACT REPORT BEGIN =====` and
`===== NETBOX CONTRACT REPORT END =====` so it can be pasted into an issue
without access to the working tree.

See [`tests/contract/README.md`](../../tests/contract/README.md) for what is
checked and why, and for the safety guarantees around the write probes.

## Until then

- The supported NetBox version range is **unknown**, not wide. See
  [`docs/compatibility.md`](../compatibility.md).
- `netbox-inventory` plugin support is **entirely unverified**: the schema
  document the derivation was built from is generated from a stock NetBox with
  no plugins installed, so `/api/plugins/**` appears nowhere in it.

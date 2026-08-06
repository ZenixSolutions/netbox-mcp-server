#!/usr/bin/env node
// Verify the built binary's CLI contract on whatever platform this is running
// on.
//
// Written in Node rather than shell deliberately: the previous version used
// `set -e`, `$?` and `> /dev/null`, none of which run on Windows, so a Windows
// job would have failed on the smoke test rather than on anything real.
//
// It checks the contract a published package has to honour — the verbs a user
// runs before they have credentials, and the exit code `--check` promises.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const ENTRY = "dist/index.js";
const EX_CONFIG = 78;

if (!existsSync(ENTRY)) {
  console.error(`::error::${ENTRY} does not exist — run \`npm run build\` first.`);
  process.exit(1);
}

/** Run the built binary with a clean environment for the config variables. */
function run(args) {
  const env = { ...process.env };
  delete env["NETBOX_URL"];
  delete env["NETBOX_TOKEN"];
  delete env["NETBOX_INSECURE"];
  return spawnSync(process.execPath, [ENTRY, ...args], { encoding: "utf8", env });
}

let failures = 0;
function check(what, condition, detail) {
  if (condition) {
    console.log(`  ok    ${what}`);
  } else {
    console.log(`::error::${what} — ${detail}`);
    failures += 1;
  }
}

console.log(`smoke test on ${process.platform}/${process.arch}, node ${process.version}`);

const version = run(["--version"]);
check(
  "--version prints the package version and exits 0",
  version.status === 0 && /^\d+\.\d+\.\d+/.test(version.stdout.trim()),
  `status=${version.status} stdout=${JSON.stringify(version.stdout)}`,
);

const help = run(["--help"]);
check(
  "--help exits 0 and mentions the required variables",
  help.status === 0 &&
    help.stdout.includes("NETBOX_URL") &&
    help.stdout.includes("NETBOX_TOKEN"),
  `status=${help.status}`,
);

const list = run(["--list-tools"]);
const toolNames = list.stdout.trim().split(/\r?\n/).filter(Boolean);
check(
  "--list-tools works with no NetBox configured",
  list.status === 0 && toolNames.length > 0,
  `status=${list.status} tools=${toolNames.length}`,
);
check(
  "every listed tool is namespaced",
  toolNames.every((n) => n.startsWith("netbox_")),
  `got ${JSON.stringify(toolNames)}`,
);

const uncheck = run(["--check"]);
check(
  `--check exits ${EX_CONFIG} with no configuration`,
  uncheck.status === EX_CONFIG,
  `got ${uncheck.status}`,
);
check(
  "--check names the variable that is missing",
  (uncheck.stderr + uncheck.stdout).includes("NETBOX_URL"),
  "the message did not name NETBOX_URL",
);

const configured = spawnSync(process.execPath, [ENTRY, "--check"], {
  encoding: "utf8",
  env: {
    ...process.env,
    NETBOX_URL: "https://netbox.invalid",
    NETBOX_TOKEN: "smoke-test-token",
  },
});
check(
  "--check exits 0 when configured, without contacting NetBox",
  configured.status === 0,
  `got ${configured.status}: ${configured.stderr}`,
);
check(
  "--check does not echo the token",
  !(configured.stdout + configured.stderr).includes("smoke-test-token"),
  "the token appeared in the output",
);

if (failures > 0) {
  console.error(`::error::${failures} smoke check(s) failed on ${process.platform}`);
  process.exit(1);
}
console.log(`all smoke checks passed on ${process.platform}/${process.arch}`);

import { defineConfig } from "vitest/config";

/**
 * The eval set, and ONLY the eval set.
 *
 * Its own config for the same reason the contract suite has one: `npm test`
 * must stay hermetic and must not start driving somebody's NetBox because a
 * developer has NETBOX_URL exported. `vitest.config.ts` includes `tests/`
 * only, so nothing under `evals/` can be picked up from the other direction
 * either.
 *
 * Single process, no parallelism: the tasks share one MCP session and one
 * schema fetch, and the output is meant to be a legible transcript rather than
 * a fast one.
 */
export default defineConfig({
  test: {
    include: ["evals/**/*.eval.test.ts"],
    environment: "node",
    globalSetup: ["evals/runner/global-setup.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    teardownTimeout: 60_000,
    fileParallelism: false,
    isolate: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    sequence: { shuffle: false, concurrent: false },
    reporters: ["verbose"],
    // Without credentials every task is `describe.skip`, which vitest counts
    // as a pass. Being unrun is never a reason for a red build.
    passWithNoTests: true,
  },
});

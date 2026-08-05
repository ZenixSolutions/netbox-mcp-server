import { defineConfig } from "vitest/config";

/**
 * The live contract suite, and ONLY the live contract suite.
 *
 * It lives in its own config rather than behind a tag so that `npm test`
 * cannot run it by accident on a developer machine that happens to have
 * NETBOX_URL exported. `vitest.config.ts` excludes `tests/contract/**` for the
 * same reason, from the other direction.
 *
 * Single process, no parallelism: this suite makes hundreds of requests to
 * someone's production source of truth, and the whole point is a legible,
 * deterministic transcript rather than a fast one.
 */
export default defineConfig({
  test: {
    include: ["tests/contract/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/contract/global-setup.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    teardownTimeout: 60_000,
    fileParallelism: false,
    isolate: false,
    pool: "forks",
    // vitest 4 removed `poolOptions`; a single worker is now set at the top
    // level. The intent is unchanged and load-bearing: these suites talk to
    // one live NetBox instance, and running files concurrently would
    // interleave requests and make the report's ordering meaningless.
    maxWorkers: 1,
    sequence: { shuffle: false, concurrent: false },
    reporters: ["verbose"],
    // Without credentials every block is `describe.skip`, which vitest counts
    // as a pass. Nothing here should ever fail a build for being unrun.
    passWithNoTests: true,
  },
});

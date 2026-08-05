// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },

  js.configs.recommended,

  {
    // Type-checked rules apply only to files the TypeScript project knows
    // about. Applying them globally makes ESLint fail on its own config file.
    files: ["src/**/*.ts", "tests/**/*.ts", "evals/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // These were warnings while the generated 446-tool layer existed, which
      // defeated the SDK's typing wholesale. That layer is gone, so they are
      // errors — the whole point of removing it was to stop paying for it.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-non-null-assertion": "error",

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      // stdout is the MCP transport. Diagnostics belong on stderr, and the
      // token must never reach either.
      "no-console": ["error", { allow: ["error"] }],
      eqeqeq: ["error", "smart"],
    },
  },

  {
    // The entry point legitimately writes to stdout: help, version, tool list.
    files: ["src/index.ts"],
    rules: { "no-console": "off" },
  },

  {
    files: ["tests/**/*.ts", "evals/**/*.ts"],
    rules: { "no-console": "off" },
  },

  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
    rules: { "no-console": "off" },
  },

  prettier,
);

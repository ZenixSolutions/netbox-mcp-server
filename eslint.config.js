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
    files: ["src/**/*.ts", "tests/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `any` is how the current tool layer defeats the SDK's typing. Warn
      // rather than error so this config can land before the rewrite that
      // removes them (issue #3), then tighten to `error`.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",

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
    files: ["tests/**/*.ts"],
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

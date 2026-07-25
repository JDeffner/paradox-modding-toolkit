// Flat config. Deliberately narrow: the codebase is already clean (zero `as
// any`, zero TODOs, strict TS everywhere) and Prettier owns formatting, so the
// job here is only the bug classes a typechecker cannot see.
//
// `recommendedTypeChecked` as a whole is the wrong tool for this repo — it
// reports ~3.2k `no-unsafe-*` hits, essentially all of them "JSON.parse returns
// any" on parsers that immediately validate their input. The type-aware rules
// below are picked one by one instead.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      // Agent worktrees are full checkouts of this repo; without this every
      // finding is reported once per worktree.
      ".claude/**",
      "packages/vscode/data/**",
      "packages/server/data/**",
      "packages/server/test/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A broken escape inside a template-built RegExp silently no-ops instead
      // of throwing; that is exactly how the scaffold prefix escape rotted.
      "no-useless-escape": "error",
      "prefer-regex-literals": "error",
      // The literal U+FEFF in `const BOM` and the `/^﻿/` strippers is the
      // most load-bearing character in this repo (CK3 silently ignores loc
      // files without a BOM). Keep the rule for bare code positions, where an
      // invisible character really is a bug, and allow the deliberate uses.
      "no-irregular-whitespace": [
        "error",
        { skipStrings: true, skipRegExps: true, skipTemplates: true, skipComments: true },
      ],
      // Fire-and-forget promises in the extension host swallow their failures.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // no-unnecessary-type-assertion is deliberately NOT enabled: it reports
      // ~300 redundant `!`s that would all become necessary again the day
      // noUncheckedIndexedAccess is turned on. Churn without signal.
      // The repo's own standing rule.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // The eval and budget suites print their measurements on purpose; those
      // numbers are the deliverable (see AGENTS.md "Testing philosophy").
      "no-console": "off",
    },
  },
  {
    // Plain-Node build scripts, outside the app tsconfig.
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Webview bodies are serialized to the browser as strings; the panel files
    // legitimately contain DOM globals inside template literals.
    files: ["packages/vscode/src/webviews/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  }
);

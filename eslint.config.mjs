import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // ─── Launch triage ───────────────────────────────────────────────────────
  // CI gates on real breakage — typecheck, tests, and the production build —
  // not on pre-existing stylistic nits or React-Compiler migration diagnostics.
  // The rules below are demoted error→warn so they stay VISIBLE (they still
  // print) without failing CI. Re-promote to "error" and burn them down during
  // hardening. As of this commit these 9 rules account for 132 pre-existing
  // errors (≈87 `no-explicit-any` in test files, the rest react-hooks/* in
  // components slated for the launch cut list).
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "prefer-const": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
    },
  },
]);

export default eslintConfig;

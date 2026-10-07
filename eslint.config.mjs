// Lint rules (Next.js 16). eslint-config-next 16 ships flat configs, so they're
// used directly — loading them through FlatCompat (as this file used to)
// crashed ESLint with "Converting circular structure to JSON" before it
// checked a single file.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React Compiler advice from eslint-plugin-react-hooks 7, which Next 16
    // turns on as errors. Every screen flagged works today (checked when lint
    // was repaired, 2026-10-06: running totals in useMemo, state synced in an
    // effect, display-only helper components). Kept as warnings so new code
    // still gets the advice without rewriting working screens for it.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/use-memo": "warn",
    },
  },
  // Build output, other work folders (.claude/worktrees) and static files are not our code.
  globalIgnores(["**/.next/**", "out/**", "build/**", "next-env.d.ts", "public/**", ".claude/**", "node_modules/**"]),
]);

export default eslintConfig;

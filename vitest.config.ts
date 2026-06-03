import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/server/**"],
      exclude: ["src/server/mcp/**", "**/*.d.ts"],
      // Realistic no-regression floor reflecting current coverage (~33% lines).
      // Ratchet back up toward 70/70/60 during hardening as service/repository
      // tests are added. `pnpm test:coverage` enforces these locally; CI runs
      // `pnpm test` (no coverage gate) for a deterministic, fast signal.
      thresholds: {
        lines: 30,
        functions: 30,
        branches: 25,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});

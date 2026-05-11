import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
  },
  resolve: {
    // Match the `@/*` alias defined in tsconfig.json so test files can
    // resolve `@/lib/...` and `@/supervisor/...` imports the same way the
    // app does at runtime.
    alias: {
      "@": resolve(process.cwd(), "src"),
    },
  },
});

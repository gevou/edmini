import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { config } from "dotenv";

export default defineConfig(() => {
  config({ path: ".env.local" });
  return {
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      globals: false,
    },
    resolve: {
      alias: {
        "@": resolve(process.cwd(), "src"),
      },
    },
  };
});

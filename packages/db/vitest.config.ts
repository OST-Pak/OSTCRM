import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Tests share one throwaway database and run in order.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
});

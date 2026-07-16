import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The APA/HDL suites build multi-GiB sparse disk images; keep the
    // default node environment and generous-but-finite timeouts.
    testTimeout: 20000,
  },
});

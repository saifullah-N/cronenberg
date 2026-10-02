import { defineConfig } from "vitest/config";

// Plain Node environment: the scanner is a local CLI, not a Worker.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

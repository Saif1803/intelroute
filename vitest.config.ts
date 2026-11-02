import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@intelroute/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    },
  },
});

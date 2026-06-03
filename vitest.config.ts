import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Limit vitest to the lib's own suites. The POC e2e harness under
    // `poc/e2e-tests` uses Node's built-in test runner (node --test) and
    // is driven by the docker-compose `e2e_tests` service, not vitest.
    include: ["test/**/*.test.ts"],
  },
});

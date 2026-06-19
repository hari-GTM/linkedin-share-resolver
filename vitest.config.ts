import { defineConfig } from 'vitest/config';

// Default test suite: fast, deterministic unit tests only.
// Live LinkedIn integration tests are excluded here and run via vitest.live.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**', 'node_modules', 'dist'],
    globals: false,
  },
});

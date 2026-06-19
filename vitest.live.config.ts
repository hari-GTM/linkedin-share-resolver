import { defineConfig } from 'vitest/config';

// Live integration suite: actually drives Playwright against LinkedIn.
// Kept OUT of the normal `npm test` run because it is slow, network-bound,
// and dependent on LinkedIn's live behaviour and (optionally) real cookies.
// Run explicitly with: npm run test:live
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    globals: false,
  },
});

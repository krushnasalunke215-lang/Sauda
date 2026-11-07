import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/src/**/*.test.ts'],
    environment: 'node',
    // The first route test in each file also pays for importing the app; on a cold cache with
    // many parallel workers that can take longer than the 5 s default.
    testTimeout: 20_000,
  },
});

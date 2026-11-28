import { defineConfig } from 'vitest/config';

/**
 * Serial performance gate. q04Perf asserts wall-clock medians, so it is kept
 * out of the parallel `npm test` run (vite.config.ts) and executed here with a
 * single worker. Thresholds are intentionally identical to the assertions in
 * tests/q04Perf.test.ts and must not be relaxed to make this gate pass.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/q04Perf.test.ts'],
    exclude: ['node_modules', 'dist', '**/.private/**'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});

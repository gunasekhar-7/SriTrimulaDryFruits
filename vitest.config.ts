import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    fileParallelism: false,
    isolate: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    reporters: ['default'],
  },
});

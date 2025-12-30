import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      AIC_TEST_MODE: '1'
    },
    include: ['tests/**/*.test.ts']
  }
});

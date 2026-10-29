import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    maxWorkers: 2,
    environment: 'jsdom', include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'], clearMocks: true, restoreMocks: true,
  },
});

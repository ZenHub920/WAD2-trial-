import { join } from 'node:path';
import { clientModule, repositoryRoot } from '../support/client-dependencies.mjs';

const { defineConfig } = await clientModule('vitest/config');
const { default: vue } = await clientModule('@vitejs/plugin-vue');
const path = value => join(repositoryRoot, value).replaceAll('\\', '/');

export default defineConfig({
  root: path('client'),
  cacheDir: path('test/results/cache/vite'),
  resolve: { dedupe: ['vue', 'vue-router', '@vue/test-utils', 'vitest'] },
  server: { fs: { allow: [repositoryRoot] } },
  plugins: [vue()],
  test: {
    maxWorkers: 2,
    environment: 'jsdom', include: [path('test/client/**/*.test.js')],
    setupFiles: [path('test/client/setup.js')], clearMocks: true, restoreMocks: true,
    coverage: { reportsDirectory: path('test/results/coverage') },
  },
});

import { join } from 'node:path';
import { defineConfig } from '../support/playwright.mjs';
import { repositoryRoot } from '../support/client-dependencies.mjs';

export default defineConfig({
  testDir: '../e2e',
  outputDir: join(repositoryRoot, 'test/results/e2e'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: join(repositoryRoot, 'test/results/playwright-report') }]],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    browserName: 'chromium',
    reducedMotion: 'reduce',
    actionTimeout: 20000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node test/support/e2e-server.mjs',
      cwd: repositoryRoot,
      url: 'http://127.0.0.1:3105/api/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5175 --strictPort',
      cwd: join(repositoryRoot, 'client'),
      env: { API_URL: 'http://127.0.0.1:3105' },
      url: 'http://127.0.0.1:5175',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});

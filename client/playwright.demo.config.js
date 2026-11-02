import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Uses the disposable local test server and synthetic users, never production.
process.env.ENCORE_RECORD_DEMO = '1';
export default defineConfig({
  ...base,
  testMatch: /community-features\.spec\.js$/,
  grep: /Kaki finder:|direct search:|automatic matching:|group connection:/,
  outputDir: './test-results/matching-demo',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/matching-demo' }]],
  use: { ...base.use, launchOptions: { slowMo: 180 } },
});

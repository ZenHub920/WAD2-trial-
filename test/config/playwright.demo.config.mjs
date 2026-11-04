import { join } from 'node:path';
import { defineConfig } from '../support/playwright.mjs';
import { repositoryRoot } from '../support/client-dependencies.mjs';
import base from './playwright.config.mjs';

// Uses the disposable local test server and synthetic users, never production.
process.env.ENCORE_RECORD_DEMO = '1';
export default defineConfig({
  ...base,
  testMatch: /community-workflows\.spec\.js$/,
  grep: /Kaki finder:|direct search:|automatic matching:|group connection:/,
  outputDir: join(repositoryRoot, 'test/results/matching-demo'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: join(repositoryRoot, 'test/results/playwright-report/matching-demo') }]],
  use: { ...base.use, launchOptions: { slowMo: 180 } },
});

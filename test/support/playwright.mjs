import { clientRequire } from './client-dependencies.mjs';

// Config and specs share the same Playwright installation and test registry.
export const { test, expect, defineConfig } = clientRequire('@playwright/test');

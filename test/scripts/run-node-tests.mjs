import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [suite, ...flags] = process.argv.slice(2);
if (!['server', 'client-node'].includes(suite)) {
  console.error('Usage: node test/scripts/run-node-tests.mjs <server|client-node> [Node test options]');
  process.exit(1);
}

const directory = fileURLToPath(new URL(`../${suite}/`, import.meta.url));
const files = readdirSync(directory)
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => join(directory, name));
if (!files.length) throw new Error(`No Node tests found in ${directory}`);

// Explicit files keep Node from discovering Vitest, Playwright or old reports.
const cwd = fileURLToPath(new URL(`../../${suite === 'server' ? 'server' : 'client'}/`, import.meta.url));
const result = spawnSync(process.execPath, ['--test', ...flags, ...files], { cwd, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

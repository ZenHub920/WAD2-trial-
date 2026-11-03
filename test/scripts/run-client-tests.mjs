import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { clientRequire, repositoryRoot } from '../support/client-dependencies.mjs';

const vitest = join(dirname(clientRequire.resolve('vitest/package.json')), 'vitest.mjs');
const cwd = join(repositoryRoot, 'client');
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
};

// npm forwards extra flags to this launcher. They belong to Vitest only, not
// the independent Node test runner which follows a successful component run.
const status = run([vitest, 'run', '--config', join(repositoryRoot, 'test/config/vitest.config.mjs'), ...process.argv.slice(2)]);
process.exitCode = status || run([join(repositoryRoot, 'test/scripts/run-node-tests.mjs'), 'client-node']);

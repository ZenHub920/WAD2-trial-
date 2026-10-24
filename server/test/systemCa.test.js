import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureSystemCa } from '../src/config/systemCa.js';

test('system CA use is opt-in and does not touch TLS by default', () => {
  assert.equal(configureSystemCa({ env: {}, tlsApi: {} }), false);
  assert.equal(configureSystemCa({ env: { ENCORE_USE_SYSTEM_CA: 'false' }, tlsApi: {} }), false);
});
test('opt-in adds only OS-trusted roots without replacing bundled/default roots', () => {
  const kinds = [], writes = [];
  const tlsApi = { getCACertificates(kind) { kinds.push(kind); return kind === 'default' ? ['bundled', 'shared'] : ['shared', 'os-trusted']; },
    setDefaultCACertificates(certificates) { writes.push(certificates); } };
  assert.equal(configureSystemCa({ env: { ENCORE_USE_SYSTEM_CA: 'true' }, tlsApi }), true);
  assert.deepEqual(kinds, ['default', 'system']);
  assert.deepEqual(writes, [['bundled', 'shared', 'os-trusted']]);
});
test('unsupported Node versions fail safely only when explicitly opted in', () => {
  assert.throws(() => configureSystemCa({ env: { ENCORE_USE_SYSTEM_CA: 'true' }, tlsApi: {} }), /system_ca_requires_supported_node_version/);
});

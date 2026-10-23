import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { generatePushKeys, runPushKeySetup } from '../src/config/generatePushKeys.js';

function fixture(t, initial = '') {
  const tempRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules');
  const folder = mkdtempSync(join(tempRoot, '.push-key-setup-'));
  t.after(() => {
    const target = resolve(folder);
    assert.ok(target.startsWith(`${tempRoot}${sep}.push-key-setup-`));
    rmSync(target, { recursive: true, force: true });
  });
  const envPath = join(folder, '.env');
  if (initial) writeFileSync(envPath, initial);
  return envPath;
}

test('key setup appends valid VAPID pair once, preserves existing settings and prints no keys', (t) => {
  const original = '# existing settings\r\nSMTP_PASSWORD="a-private-smtp-password"\r\nTICKETMASTER_API_KEY=private-ticket-key';
  const envPath = fixture(t, original), output = [];
  assert.equal(runPushKeySetup({ envPath, env: {}, args: ['mailto:owner@example.org'], write: (line) => output.push(line) }), 0);
  const contents = readFileSync(envPath, 'utf8'), values = parse(contents);
  assert.ok(contents.startsWith(original + '\r\n'));
  assert.equal(values.SMTP_PASSWORD, 'a-private-smtp-password');
  assert.equal(values.TICKETMASTER_API_KEY, 'private-ticket-key');
  assert.equal(values.VAPID_SUBJECT, 'mailto:owner@example.org');
  assert.equal(Buffer.from(values.VAPID_PUBLIC_KEY, 'base64url').length, 65);
  assert.equal(Buffer.from(values.VAPID_PRIVATE_KEY, 'base64url').length, 32);
  const curve = createECDH('prime256v1');curve.setPrivateKey(Buffer.from(values.VAPID_PRIVATE_KEY, 'base64url'));
  assert.equal(curve.getPublicKey().toString('base64url'), values.VAPID_PUBLIC_KEY);
  const before = contents;
  assert.equal(runPushKeySetup({ envPath, env: {}, args: [], write: (line) => output.push(line) }), 1);
  assert.equal(readFileSync(envPath, 'utf8'), before);
  for (const secret of [values.VAPID_PRIVATE_KEY, values.VAPID_PUBLIC_KEY, values.SMTP_PASSWORD, values.TICKETMASTER_API_KEY])
    assert.equal(output.join('').includes(secret), false);
  assert.equal(existsSync(`${envPath}.push-keygen.lock`), false);
});

test('key setup preserves an existing contact and refuses partial keys without changing the file', (t) => {
  const envPath = fixture(t, 'VAPID_SUBJECT="https://encore.example/contact"\nOTHER=value\n');
  generatePushKeys({ envPath, env: {} });
  assert.equal(readFileSync(envPath, 'utf8').match(/VAPID_SUBJECT=/g).length, 1);
  const partial = fixture(t, 'VAPID_PUBLIC_KEY=existing-public\n');
  assert.throws(() => generatePushKeys({ envPath: partial, env: {} }), /push_keys_already_configured/);
  assert.equal(readFileSync(partial, 'utf8'), 'VAPID_PUBLIC_KEY=existing-public\n');
});

test('key setup rejects injected contacts and environment-configured keys, and explains placeholder contact', (t) => {
  const envPath = fixture(t), output = [];
  assert.throws(() => generatePushKeys({ envPath, env: {}, subject: 'mailto:owner@example.org\nEXTRA=bad' }), /invalid_vapid_contact/);
  assert.equal(existsSync(envPath), false);
  assert.throws(() => generatePushKeys({ envPath, env: { VAPID_PRIVATE_KEY: 'configured-elsewhere' } }), /push_keys_already_configured/);
  assert.equal(runPushKeySetup({ envPath, env: {}, args: [], write: (line) => output.push(line) }), 0);
  assert.ok(output.join('').includes('Replace VAPID_SUBJECT'));
  assert.equal(parse(readFileSync(envPath, 'utf8')).VAPID_SUBJECT, 'mailto:replace-me@example.invalid');
});

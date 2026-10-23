import { createECDH } from 'node:crypto';
import { appendFileSync, closeSync, lstatSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const defaultPath = join(dirname(fileURLToPath(import.meta.url)), '../../.env');
const placeholder = 'mailto:replace-me@example.invalid';
const failure = (code) => Object.assign(new Error(code), { code });
function validateContact(subject) {
  if (typeof subject !== 'string' || subject.length > 500 || /[\r\n\0]/.test(subject))
    throw failure('invalid_vapid_contact');
  let url;
  try { url = new URL(subject); } catch { throw failure('invalid_vapid_contact'); }
  if (url.protocol === 'mailto:' && /^[^\s@?]+@[^\s@?]+\.[^\s@?]+$/.test(url.pathname)) return subject;
  if (url.protocol === 'https:' && !url.username && !url.password && url.hostname) return subject;
  throw failure('invalid_vapid_contact');
}

/** Append once; never print or return key material, and never replace other settings. */
export function generatePushKeys({ envPath = defaultPath, subject, env = process.env } = {}) {
  const filePath = resolve(envPath);
  const lockPath = `${filePath}.push-keygen.lock`;
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch { throw failure('push_key_generation_locked'); }
  try {
    let existing = '';
    try {
      if (lstatSync(filePath).isSymbolicLink()) throw failure('push_environment_symlink_not_supported');
      existing = readFileSync(filePath, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const values = parse(existing);
    // Also refuse a partial pair. Replacing only one would invalidate every device.
    if (values.VAPID_PUBLIC_KEY?.trim() || values.VAPID_PRIVATE_KEY?.trim()
      || env.VAPID_PUBLIC_KEY?.trim() || env.VAPID_PRIVATE_KEY?.trim())
      throw failure('push_keys_already_configured');
    const contact = validateContact(subject || values.VAPID_SUBJECT || env.VAPID_SUBJECT || placeholder);
    if (values.VAPID_SUBJECT && values.VAPID_SUBJECT !== contact)
      throw failure('push_contact_already_configured');
    const curve = createECDH('prime256v1');
    const publicKey = curve.generateKeys().toString('base64url');
    const privateKey = curve.getPrivateKey().toString('base64url');
    const newline = existing.includes('\r\n') ? '\r\n' : '\n';
    const prefix = existing && !existing.endsWith('\n') ? newline : '';
    const lines = [
      '# Browser push signing keys. Keep this file private and ignored by Git.',
      `VAPID_PUBLIC_KEY=${publicKey}`,
      `VAPID_PRIVATE_KEY=${privateKey}`,
      ...(!values.VAPID_SUBJECT ? [`VAPID_SUBJECT=${JSON.stringify(contact)}`] : []),
      '',
    ];
    appendFileSync(filePath, prefix + lines.join(newline), { encoding: 'utf8', mode: 0o600 });
    return { created: true, filePath, contactNeedsUpdate: contact === placeholder };
  } finally { closeSync(lock); unlinkSync(lockPath); }
}

export function runPushKeySetup({ args = process.argv.slice(2), env = process.env,
  envPath = defaultPath, write = (text) => process.stdout.write(text) } = {}) {
  if (args.length > 1) { write('Usage: npm run push:keys -- mailto:you@example.org\n'); return 1; }
  try {
    const result = generatePushKeys({ envPath, subject: args[0], env });
    write('Browser notification keys added to server/.env. No keys were printed.\n');
    if (result.contactNeedsUpdate) write('Replace VAPID_SUBJECT with your real contact address before enabling notifications.\n');
    return 0;
  } catch (error) {
    const messages = {
      push_keys_already_configured: 'Push keys already exist. Existing keys and configuration were preserved.',
      invalid_vapid_contact: 'Use a valid mailto: contact address or HTTPS contact URL.',
      push_contact_already_configured: 'VAPID_SUBJECT already exists. Keep its current value or edit it locally before retrying.',
      push_key_generation_locked: 'Another key setup may be running. Check server/.env.push-keygen.lock before retrying.',
      push_environment_symlink_not_supported: 'Refusing to modify a linked environment file.',
    };
    write(`${messages[error.code] || 'Could not configure push keys. Check write access to server/.env.'}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runPushKeySetup();

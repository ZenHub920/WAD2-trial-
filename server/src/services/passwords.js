import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const validPassword = (value) => typeof value === 'string'
  && value.length >= 8 && value.length <= 1024;

export function hashPassword(password) {
  if (!validPassword(password)) throw new Error('password_must_be_8_to_1024_characters');
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 1024 || typeof stored !== 'string') return false;
  const [algorithm, salt, expectedHex] = stored.split('$');
  if (algorithm !== 'scrypt' || !/^[0-9a-f]{32}$/.test(salt ?? '')
      || !/^[0-9a-f]{128}$/.test(expectedHex ?? '')) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expectedHex, 'hex'));
}

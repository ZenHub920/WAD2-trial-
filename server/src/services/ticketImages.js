import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function isPng(data) {
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let offset = 8;
  let idat = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    if (length > data.length - offset - 12) return false;
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (offset === 8 && (type !== 'IHDR' || length !== 13
      || !data.readUInt32BE(offset + 8) || !data.readUInt32BE(offset + 12))) return false;
    if (type === 'IDAT') idat = true;
    offset += length + 12;
    if (type === 'IEND') return length === 0 && idat && offset === data.length;
  }
  return false;
}

function isJpeg(data) {
  if (data.length < 32 || data[0] !== 0xff || data[1] !== 0xd8
    || data.at(-2) !== 0xff || data.at(-1) !== 0xd9) return false;
  let offset = 2;
  let frame = false;
  while (offset + 4 <= data.length) {
    if (data[offset++] !== 0xff) return false;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xda) return frame && offset + 2 < data.length
      && data.readUInt16BE(offset) >= 6 && offset + data.readUInt16BE(offset) < data.length - 2;
    if (marker === 0xd9 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || !data.readUInt16BE(offset + 3) || !data.readUInt16BE(offset + 5)) return false;
      frame = true;
    }
    offset += length;
  }
  return false;
}

/** Decode only supported image data URIs, verifying the bytes rather than trusting the MIME label. */
export function decodeTicketImage(value) {
  if (typeof value !== 'string') throw new Error('invalid_image');
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > Math.ceil(MAX_BYTES / 3) * 4 + 4 || match[2].length % 4 !== 0) {
    throw new Error('invalid_image');
  }
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > MAX_BYTES || data.toString('base64') !== match[2]) {
    throw new Error('invalid_image');
  }
  let ext;
  if (data.length >= 45 && isPng(data)) ext = 'png';
  else if (isJpeg(data)) ext = 'jpg';
  else if (data.length >= 14 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))
    && data.readUInt16LE(6) > 0 && data.readUInt16LE(8) > 0 && data.at(-1) === 0x3b) ext = 'gif';
  else if (data.length >= 20 && data.toString('ascii', 0, 4) === 'RIFF'
    && data.toString('ascii', 8, 12) === 'WEBP' && data.readUInt32LE(4) + 8 === data.length
    && ['VP8 ', 'VP8L', 'VP8X'].includes(data.toString('ascii', 12, 16))) ext = 'webp';
  if (!ext || match[1] !== TYPES[ext]) throw new Error('invalid_image');
  return { data, ext };
}

export function createTicketImages(directory) {
  return {
    directory,
    save(value) {
      const { data, ext } = decodeTicketImage(value);
      mkdirSync(directory, { recursive: true });
      const name = `${randomUUID()}.${ext}`;
      writeFileSync(join(directory, name), data, { flag: 'wx' });
      return name;
    },
    remove(name) {
      if (!name) return;
      try { unlinkSync(join(directory, name)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    },
  };
}

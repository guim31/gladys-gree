// -----------------------------------------------------------------------------
// The encryption of the Gree Wi-Fi protocol.
//
// Every message is a JSON envelope whose `pack` field carries another JSON
// object, encrypted with AES-128 and encoded in base64. Two generations exist:
//
//   - ECB, the historical one: AES-128-ECB, PKCS#7 padding;
//   - GCM, on recent firmware: AES-128-GCM with a fixed nonce and associated
//     data, the authentication tag travelling in the envelope's `tag` field.
//
// Before binding, both sides use a generic key, the same on every unit of a
// generation (scan replies, bind requests). The bind reply gives the unit's own
// key, used for everything after. The generic keys and the GCM nonce are
// constants of the protocol, published by every open implementation (see the
// README credits).
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv } from 'node:crypto';

export const CIPHERS = { ECB: 'ecb', GCM: 'gcm' };

export const GENERIC_KEYS = {
  [CIPHERS.ECB]: 'a3K8Bx%2r8Y7#xDh',
  [CIPHERS.GCM]: '{yxAHAY_Lm6pbC/<',
};

const GCM_NONCE = Buffer.from('5440784449675a516c5e6313', 'hex');
const GCM_AAD = Buffer.from('qualcomm-test');

export class GreeCryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GreeCryptoError';
  }
}

const keyBytes = (key) => {
  const bytes = Buffer.from(String(key ?? ''), 'utf8');
  if (bytes.length !== 16) {
    throw new GreeCryptoError('A Gree key has 16 characters');
  }
  return bytes;
};

/**
 * Encrypt one pack.
 * @param {object} pack the inner JSON object
 * @param {string} key 16-character key (generic or the unit's)
 * @param {'ecb'|'gcm'} cipher
 * @returns {{ pack: string, tag?: string }} base64 strings for the envelope
 */
export function encryptPack(pack, key, cipher) {
  const plain = Buffer.from(JSON.stringify(pack), 'utf8');
  if (cipher === CIPHERS.GCM) {
    const aes = createCipheriv('aes-128-gcm', keyBytes(key), GCM_NONCE);
    aes.setAAD(GCM_AAD);
    const encrypted = Buffer.concat([aes.update(plain), aes.final()]);
    return { pack: encrypted.toString('base64'), tag: aes.getAuthTag().toString('base64') };
  }
  const aes = createCipheriv('aes-128-ecb', keyBytes(key), null);
  return { pack: Buffer.concat([aes.update(plain), aes.final()]).toString('base64') };
}

/**
 * Decrypt one pack. Throws a GreeCryptoError when the key is not the right
 * one: the result is not JSON (ECB), or the tag does not match (GCM).
 * @param {string} pack base64 of the encrypted object
 * @param {string} key
 * @param {'ecb'|'gcm'} cipher
 * @param {string} [tag] base64 GCM tag, checked when present
 * @returns {object}
 */
export function decryptPack(pack, key, cipher, tag) {
  if (typeof pack !== 'string' || pack === '') {
    throw new GreeCryptoError('Empty pack');
  }
  const data = Buffer.from(pack, 'base64');
  let plain;
  try {
    if (cipher === CIPHERS.GCM) {
      const aes = createDecipheriv('aes-128-gcm', keyBytes(key), GCM_NONCE);
      aes.setAAD(GCM_AAD);
      if (typeof tag === 'string' && tag !== '') {
        aes.setAuthTag(Buffer.from(tag, 'base64'));
        plain = Buffer.concat([aes.update(data), aes.final()]);
      } else {
        plain = aes.update(data);
      }
    } else {
      if (data.length === 0 || data.length % 16 !== 0) {
        throw new GreeCryptoError('An ECB pack is made of 16-byte blocks');
      }
      const aes = createDecipheriv('aes-128-ecb', keyBytes(key), null);
      // Some firmware pads with zeros instead of PKCS#7: cut after the JSON.
      aes.setAutoPadding(false);
      plain = Buffer.concat([aes.update(data), aes.final()]);
    }
  } catch (err) {
    throw err instanceof GreeCryptoError
      ? err
      : new GreeCryptoError(`Cannot decrypt the pack: ${err.message}`);
  }
  const text = plain.toString('latin1');
  const end = text.lastIndexOf('}');
  if (end < 0) {
    throw new GreeCryptoError('The decrypted pack is not JSON');
  }
  try {
    const decoded = JSON.parse(plain.subarray(0, end + 1).toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('not an object');
    }
    return decoded;
  } catch {
    throw new GreeCryptoError('The decrypted pack is not JSON');
  }
}

/**
 * Decrypt a pack made with a generic key, without knowing the generation:
 * ECB first (most units), then GCM.
 * @returns {{ pack: object, cipher: 'ecb'|'gcm' }}
 */
export function decryptGenericPack(pack, tag) {
  const order =
    typeof tag === 'string' && tag !== '' ? [CIPHERS.GCM, CIPHERS.ECB] : [CIPHERS.ECB, CIPHERS.GCM];
  let lastError = null;
  for (const cipher of order) {
    try {
      return { pack: decryptPack(pack, GENERIC_KEYS[cipher], cipher, tag), cipher };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

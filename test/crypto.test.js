// -----------------------------------------------------------------------------
// The encryption of the protocol, against vectors made by an independent
// implementation (Python `cryptography`, test/fixtures/gree/crypto-vectors.json).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  CIPHERS,
  GENERIC_KEYS,
  GreeCryptoError,
  decryptGenericPack,
  decryptPack,
  encryptPack,
} from '../src/gree/crypto.js';

const vectors = JSON.parse(
  await readFile(new URL('./fixtures/gree/crypto-vectors.json', import.meta.url), 'utf8'),
);

test('ECB: the same bytes as the independent implementation, both ways', () => {
  assert.equal(encryptPack(vectors.plain, GENERIC_KEYS.ecb, CIPHERS.ECB).pack, vectors.ecb);
  assert.deepEqual(decryptPack(vectors.ecb, GENERIC_KEYS.ecb, CIPHERS.ECB), vectors.plain);
});

test('GCM: the same bytes and tag as the independent implementation, both ways', () => {
  const sealed = encryptPack(vectors.plain, GENERIC_KEYS.gcm, CIPHERS.GCM);
  assert.equal(sealed.pack, vectors.gcm);
  assert.equal(sealed.tag, vectors.tag);
  assert.deepEqual(
    decryptPack(vectors.gcm, GENERIC_KEYS.gcm, CIPHERS.GCM, vectors.tag),
    vectors.plain,
  );
  // A reply without its tag still opens (not every firmware sends it).
  assert.deepEqual(decryptPack(vectors.gcm, GENERIC_KEYS.gcm, CIPHERS.GCM), vectors.plain);
});

test('a scan reply tells its generation: ECB first, GCM next, or GCM when a tag comes', () => {
  assert.deepEqual(decryptGenericPack(vectors.ecb), { pack: vectors.plain, cipher: 'ecb' });
  assert.deepEqual(decryptGenericPack(vectors.gcm), { pack: vectors.plain, cipher: 'gcm' });
  assert.deepEqual(decryptGenericPack(vectors.gcm, vectors.tag), {
    pack: vectors.plain,
    cipher: 'gcm',
  });
});

test('the wrong key, a forged tag or garbage throw a GreeCryptoError', () => {
  const other = 'abcdefghijklmnop';
  assert.throws(() => decryptPack(vectors.ecb, other, CIPHERS.ECB), GreeCryptoError);
  assert.throws(() => decryptPack(vectors.gcm, other, CIPHERS.GCM, vectors.tag), GreeCryptoError);
  const forged = Buffer.from(vectors.tag, 'base64');
  forged[0] ^= 1;
  assert.throws(
    () => decryptPack(vectors.gcm, GENERIC_KEYS.gcm, CIPHERS.GCM, forged.toString('base64')),
    GreeCryptoError,
  );
  assert.throws(() => decryptPack('', GENERIC_KEYS.ecb, CIPHERS.ECB), GreeCryptoError);
  assert.throws(() => decryptPack('AAAA', GENERIC_KEYS.ecb, CIPHERS.ECB), GreeCryptoError);
  assert.throws(() => decryptGenericPack(Buffer.alloc(32).toString('base64')), GreeCryptoError);
  assert.throws(() => encryptPack({}, 'short', CIPHERS.ECB), GreeCryptoError);
});

test('an ECB pack padded with zeros instead of PKCS#7 still opens', () => {
  const plain = Buffer.from(JSON.stringify({ t: 'dat', r: 200 }));
  const padded = Buffer.concat([plain, Buffer.alloc(16 - (plain.length % 16))]);
  const aes = createCipheriv('aes-128-ecb', Buffer.from(GENERIC_KEYS.ecb), null);
  aes.setAutoPadding(false);
  const pack = Buffer.concat([aes.update(padded), aes.final()]).toString('base64');
  assert.deepEqual(decryptPack(pack, GENERIC_KEYS.ecb, CIPHERS.ECB), { t: 'dat', r: 200 });
});

test('a unit key round-trips, with non-ASCII text', () => {
  const key = 'Kx0001fakeUnitKy';
  for (const cipher of [CIPHERS.ECB, CIPHERS.GCM]) {
    const pack = { t: 'dev', name: 'Séjour été' };
    const sealed = encryptPack(pack, key, cipher);
    assert.deepEqual(decryptPack(sealed.pack, key, cipher, sealed.tag), pack);
  }
});

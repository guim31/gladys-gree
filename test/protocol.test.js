// -----------------------------------------------------------------------------
// The messages of the protocol and the conversions of the unit's properties.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC_KEYS, decryptPack, encryptPack } from '../src/gree/crypto.js';
import {
  SCAN_REQUEST,
  bindRequest,
  commandRequest,
  firmwareVersion,
  indoorTemperature,
  normalizeMac,
  normalizeProps,
  parseEnvelope,
  parseScanReply,
  statusRequest,
  zipValues,
} from '../src/gree/protocol.js';

const MAC = '02ab00000001';
const KEY = 'Kx0001fakeUnitKy';

test('the scan request is the clear JSON every unit answers', () => {
  assert.deepEqual(JSON.parse(SCAN_REQUEST.toString()), { t: 'scan' });
});

test('bind, status and command requests: envelope and encrypted pack', () => {
  for (const cipher of ['ecb', 'gcm']) {
    const bind = JSON.parse(bindRequest(MAC, cipher).toString());
    assert.equal(bind.t, 'pack');
    assert.equal(bind.i, 1, 'a bind uses the generic key');
    assert.equal(bind.tcid, MAC);
    assert.equal(typeof bind.tag === 'string', cipher === 'gcm');
    assert.deepEqual(decryptPack(bind.pack, GENERIC_KEYS[cipher], cipher, bind.tag), {
      mac: MAC,
      t: 'bind',
      uid: 0,
    });

    const unit = { mac: MAC, key: KEY, cipher };
    const status = JSON.parse(statusRequest(unit, ['Pow', 'Mod']).toString());
    assert.equal(status.i, 0, 'a status uses the unit key');
    assert.deepEqual(decryptPack(status.pack, KEY, cipher, status.tag), {
      cols: ['Pow', 'Mod'],
      mac: MAC,
      t: 'status',
    });

    const command = JSON.parse(commandRequest(unit, { Pow: 1, SetTem: 24 }).toString());
    assert.deepEqual(decryptPack(command.pack, KEY, cipher, command.tag), {
      opt: ['Pow', 'SetTem'],
      p: [1, 24],
      t: 'cmd',
      mac: MAC,
    });
  }
});

test('a scan reply gives the MAC, the name and the generation of the unit', () => {
  const dev = { t: 'dev', cid: MAC, mac: MAC, name: ' Salon ', brand: 'gree', ver: 'V1.2.1' };
  const ecb = { t: 'pack', i: 1, cid: MAC, ...encryptPack(dev, GENERIC_KEYS.ecb, 'ecb') };
  assert.deepEqual(parseScanReply(ecb), {
    mac: MAC,
    name: 'Salon',
    brand: 'gree',
    model: '',
    version: 'V1.2.1',
    cipher: 'ecb',
  });
  const gcm = { t: 'pack', i: 1, cid: MAC, ...encryptPack(dev, GENERIC_KEYS.gcm, 'gcm') };
  assert.equal(parseScanReply(gcm).cipher, 'gcm');
  // The MAC can come from `cid` only.
  const bare = {
    t: 'pack',
    ...encryptPack({ t: 'dev', cid: '02:AB:00:00:00:09' }, GENERIC_KEYS.ecb, 'ecb'),
  };
  assert.equal(parseScanReply(bare).mac, '02ab00000009');
  assert.throws(() => parseScanReply({ t: 'pack' }));
  assert.throws(() =>
    parseScanReply({ t: 'pack', ...encryptPack({ t: 'bindok' }, GENERIC_KEYS.ecb, 'ecb') }),
  );
  assert.throws(() =>
    parseScanReply({ t: 'pack', ...encryptPack({ t: 'dev' }, GENERIC_KEYS.ecb, 'ecb') }),
  );
});

test('indoor temperature: +40 offset on most firmware, none on some, 0 means no sensor', () => {
  assert.equal(indoorTemperature({ TemSen: 65 }), 25);
  assert.equal(indoorTemperature({ TemSen: 40 }), 0);
  assert.equal(indoorTemperature({ TemSen: 24 }), 24);
  assert.equal(indoorTemperature({ TemSen: 0 }), null);
  assert.equal(indoorTemperature({}), null);
  assert.equal(indoorTemperature(null), null);
});

test('firmware version from hid', () => {
  assert.equal(firmwareVersion('362001000762+U-CS532AE(LT)V3.31.bin'), '3.31');
  assert.equal(firmwareVersion(''), null);
  assert.equal(firmwareVersion(undefined), null);
});

test('values: zipped, integers only, empty and unknown values dropped', () => {
  assert.deepEqual(zipValues(['Pow', 'Mod', 'X'], [1, '4']), { Pow: 1, Mod: '4' });
  assert.deepEqual(zipValues('Pow', [1]), {});
  assert.deepEqual(
    normalizeProps({ Pow: 1, Mod: '4', Air: '', SetTem: 23.6, Lig: null, hid: 'U-XV1.0.bin' }),
    { Pow: 1, Mod: 4, SetTem: 24, hid: 'U-XV1.0.bin' },
  );
});

test('MAC addresses and envelopes', () => {
  assert.equal(normalizeMac('02:AB:00:00:00:01'), MAC);
  assert.equal(normalizeMac('02ab0000'), null);
  assert.equal(normalizeMac(12), null);
  assert.deepEqual(parseEnvelope(Buffer.from('{"t":"scan"}')), { t: 'scan' });
  assert.equal(parseEnvelope(Buffer.from('[1]')), null);
  assert.equal(parseEnvelope(Buffer.from('not json')), null);
});

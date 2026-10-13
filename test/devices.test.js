// -----------------------------------------------------------------------------
// From the unit's properties to the Gladys values, and from a Gladys command
// to the properties to set: the mode order differs, fan speeds, quiet, turbo
// and swings map one to one.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AC_FAN_SPEED,
  AC_MODE,
  FEATURE_KEYS,
  capabilitiesOf,
  commandFor,
  deviceName,
  deviceValues,
  featureSpecs,
  greeMode,
  gladysMode,
} from '../src/devices.js';
import { loadFixture } from './helpers/fakeGree.js';

const record = (props, caps = capabilitiesOf(props)) => ({ props, caps });

test('the modes: Gree auto, cool, dry, fan, heat are Gladys auto, cooling, drying, fan, heating', () => {
  const pairs = [
    [0, AC_MODE.AUTO],
    [1, AC_MODE.COOLING],
    [2, AC_MODE.DRYING],
    [3, AC_MODE.FAN],
    [4, AC_MODE.HEATING],
  ];
  for (const [gree, gladys] of pairs) {
    assert.equal(gladysMode(gree), gladys);
    assert.equal(greeMode(gladys), gree);
    assert.deepEqual(commandFor(record({}), FEATURE_KEYS.MODE, gladys), { Mod: gree });
  }
  assert.equal(gladysMode(9), null);
  assert.throws(() => greeMode(9));
});

test('the values of the classic fixture', () => {
  const { status } = loadFixture('ecb-v1.2-sensor-offset');
  assert.deepEqual(deviceValues(record(status)), {
    power: 1,
    mode: AC_MODE.COOLING,
    'target-temperature': 24,
    'indoor-temperature': 25,
    'fan-speed': AC_FAN_SPEED.AUTO,
    'swing-vertical': 1,
    'swing-horizontal': 0,
    'display-light': 1,
    eco: 0,
    'frost-guard': 0,
    sleep: 0,
    'x-fan': 1,
    health: 1,
  });
});

test('fan speed: turbo and quiet win over the speed they override', () => {
  const base = { Pow: 1, WdSpd: 3, Tur: 0, Quiet: 0 };
  assert.equal(deviceValues(record(base))['fan-speed'], AC_FAN_SPEED.MID);
  assert.equal(deviceValues(record({ ...base, Quiet: 2 }))['fan-speed'], AC_FAN_SPEED.QUIET);
  assert.equal(deviceValues(record({ ...base, Quiet: 1 }))['fan-speed'], AC_FAN_SPEED.QUIET);
  assert.equal(deviceValues(record({ ...base, Tur: 1 }))['fan-speed'], AC_FAN_SPEED.TURBO);

  const set = (speed) => commandFor(record(base), FEATURE_KEYS.FAN, speed);
  assert.deepEqual(set(AC_FAN_SPEED.HIGH), { WdSpd: 5, Tur: 0, Quiet: 0 });
  assert.deepEqual(set(AC_FAN_SPEED.QUIET), { Quiet: 2, Tur: 0 });
  assert.deepEqual(set(AC_FAN_SPEED.TURBO), { Tur: 1, Quiet: 0 });
  assert.throws(() => set(8));
});

test('swing: fixed positions map one to one, partial swings read as a swing', () => {
  assert.equal(deviceValues(record({ SwUpDn: 4 }))['swing-vertical'], 4);
  for (const partial of [7, 8, 9, 10, 11]) {
    assert.equal(deviceValues(record({ SwUpDn: partial }))['swing-vertical'], 1);
  }
  assert.deepEqual(commandFor(record({}), FEATURE_KEYS.SWING_VERTICAL, 6), { SwUpDn: 6 });
  assert.deepEqual(commandFor(record({}), FEATURE_KEYS.SWING_HORIZONTAL, 9), { SwingLfRig: 6 });
});

test('setpoint: whole degrees within 16-30 °C, the display unit kept', () => {
  assert.deepEqual(commandFor(record({ TemUn: 0 }), FEATURE_KEYS.TARGET, 22.4), {
    SetTem: 22,
    TemUn: 0,
    TemRec: 0,
  });
  assert.deepEqual(commandFor(record({ TemUn: 1 }), FEATURE_KEYS.TARGET, '35'), {
    SetTem: 30,
    TemUn: 1,
    TemRec: 0,
  });
  assert.equal(commandFor(record({}), FEATURE_KEYS.TARGET, 10).SetTem, 16);
  assert.throws(() => commandFor(record({}), FEATURE_KEYS.TARGET, 'warm'));
});

test('switches: power, display light, eco, frost guard, X-Fan, health, sleep with its curve', () => {
  const r = record({});
  assert.deepEqual(commandFor(r, FEATURE_KEYS.POWER, 1), { Pow: 1 });
  assert.deepEqual(commandFor(r, FEATURE_KEYS.LIGHT, 0), { Lig: 0 });
  assert.deepEqual(commandFor(r, FEATURE_KEYS.ECO, 1), { SvSt: 1 });
  assert.deepEqual(commandFor(r, FEATURE_KEYS.FROST_GUARD, 1), { StHt: 1 });
  assert.deepEqual(commandFor(r, FEATURE_KEYS.XFAN, 1), { Blo: 1 });
  assert.deepEqual(commandFor(r, FEATURE_KEYS.HEALTH, 0), { Health: 0 });
  assert.deepEqual(commandFor(r, FEATURE_KEYS.SLEEP, 1), { SwhSlp: 1, SlpMod: 1 });
  assert.throws(() => commandFor(r, FEATURE_KEYS.INDOOR, 20), /cannot be controlled/);
});

test('capabilities: what the unit reports, and never fewer than before', () => {
  const { status } = loadFixture('ecb-v1.0-no-sensor');
  const caps = capabilitiesOf(status);
  assert.deepEqual(caps, {
    indoor: false,
    swingHorizontal: false,
    'display-light': true,
    eco: false,
    'frost-guard': false,
    sleep: true,
    'x-fan': true,
    health: false,
  });
  const keys = featureSpecs(caps, 'en').map((spec) => spec.key);
  assert.deepEqual(keys, [
    'power',
    'mode',
    'target-temperature',
    'fan-speed',
    'swing-vertical',
    'display-light',
    'sleep',
    'x-fan',
  ]);
  // A sensor that answers later is added; a property missing once removes nothing.
  const grown = capabilitiesOf({ TemSen: 62 }, caps);
  assert.equal(grown.indoor, true);
  assert.equal(capabilitiesOf({}, grown)['x-fan'], true);
  // No sensor: no indoor value, even if TemSen moves.
  assert.equal(deviceValues(record({ TemSen: 0 }, caps))['indoor-temperature'], undefined);
});

test('names: the one given in the Gree app, or the end of the MAC', () => {
  assert.equal(deviceName({ mac: '02ab00000002', name: 'Salon' }), 'Gree Salon');
  assert.equal(deviceName({ mac: '02ab00000003', name: '1e3c6a7b' }), 'Gree 000003');
  assert.equal(deviceName({ mac: '02ab00000003', name: '' }), 'Gree 000003');
});

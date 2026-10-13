// -----------------------------------------------------------------------------
// Scene actions: settings in one command, every unit off.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASSIC,
  FakeGree,
  NO_SENSOR,
  RECENT,
  createAll,
  createWorld,
  deviceId,
} from './helpers/world.js';

async function world(t, units) {
  const created = await createWorld({ units });
  t.after(() => created.app.stop());
  await createAll(created);
  return created;
}

test('apply_settings: on, mode, setpoint and fan speed in a single command', async (t) => {
  const unit = new FakeGree(NO_SENSOR, '192.0.2.10');
  const w = await world(t, [unit]);
  const ack = await w.fake.sceneAction('apply_settings', {
    device: deviceId(w.gladys, unit.mac),
    mode: 'cool',
    target_temperature: 23,
    fan_speed: 'quiet',
  });
  assert.equal(ack.success, true, ack.error);
  const commands = unit.requests('cmd');
  assert.equal(commands.length, 1, 'one command, one beep');
  assert.deepEqual(commands[0].opt, ['Pow', 'Mod', 'SetTem', 'TemUn', 'TemRec', 'Quiet', 'Tur']);
  assert.deepEqual(commands[0].p, [1, 1, 23, 0, 0, 2, 0]);
  // No sensor on this unit: no output rather than a made-up value.
  assert.deepEqual(ack.data?.outputs ?? ack.data ?? {}, {});
});

test('apply_settings: the mode alone, and the indoor temperature as output', async (t) => {
  const unit = new FakeGree(RECENT, '192.0.2.10');
  const w = await world(t, [unit]);
  const ack = await w.fake.sceneAction('apply_settings', {
    device: deviceId(w.gladys, unit.mac),
    mode: 'heat',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(unit.requests('cmd')[0].opt, ['Pow', 'Mod']);
  assert.deepEqual(ack.data.outputs ?? ack.data, { indoor_temperature: 24 });
});

test('apply_settings: an unknown mode or device fails with a clear error', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const w = await world(t, [unit]);
  const wrongMode = await w.fake.sceneAction('apply_settings', {
    device: deviceId(w.gladys, unit.mac),
    mode: 'boost',
  });
  assert.equal(wrongMode.success, false);
  assert.match(wrongMode.error, /Unknown mode "boost"/);
  const wrongDevice = await w.fake.sceneAction('apply_settings', {
    device: 'ext:test-integration:gree:02ab000000ff',
    mode: 'cool',
  });
  assert.equal(wrongDevice.success, false);
  assert.match(wrongDevice.error, /not known yet|inconnu/);
  assert.equal(unit.count('cmd'), 0);
});

test('turn_off_all: every running unit, and how many', async (t) => {
  const units = [
    new FakeGree(CLASSIC, '192.0.2.10'),
    new FakeGree(RECENT, '192.0.2.11'),
    new FakeGree(NO_SENSOR, '192.0.2.12'),
  ];
  const w = await world(t, units);
  const ack = await w.fake.sceneAction('turn_off_all', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs ?? ack.data, { count: 2 });
  assert.deepEqual(
    units.map((unit) => [unit.props.Pow, unit.count('cmd')]),
    [
      [0, 1],
      [0, 1],
      [0, 0],
    ],
  );
});

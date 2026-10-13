// -----------------------------------------------------------------------------
// The hub against fake Gree units and the SDK's fake Gladys: discovery through
// the core, pairing, /data, states, commands, reachability, a unit paired
// again, the trigger.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AC_FAN_SPEED, AC_MODE, FEATURE_KEYS } from '../src/devices.js';
import { TRIGGER } from '../src/hub.js';
import {
  CLASSIC,
  FakeGree,
  NO_SENSOR,
  RECENT,
  allUnits,
  createAll,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

async function created(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const lastState = (world, mac, key) => world.fake.lastState(featureId(world.gladys, mac, key));
const feature = (world, mac, key) => ({ external_id: featureId(world.gladys, mac, key) });
const device = (world, mac) =>
  world.fake.discoveredDevices.find((entry) => entry.external_id === deviceId(world.gladys, mac));

test('discovery through the core: every unit found, paired once, published', async (t) => {
  const units = allUnits();
  const world = await createWorld({ units });
  t.after(() => world.app.stop());
  const [scan] = world.fake.scans;
  assert.equal(scan.type, 'udp-active-broadcast');
  assert.equal(scan.port, 7000);
  assert.deepEqual(JSON.parse(Buffer.from(scan.payload_base64, 'base64')), { t: 'scan' });

  assert.equal(world.fake.discoveredDevices.length, units.length);
  for (const unit of units) {
    assert.equal(unit.count('bind'), 1, `${unit.fixture}: bound once`);
    const published = device(world, unit.mac);
    assert.ok(published, unit.fixture);
    assert.deepEqual(published.params.slice(0, 2), [
      { name: 'IP_ADDRESS', value: unit.host },
      { name: 'MAC_ADDRESS', value: unit.mac },
    ]);
  }
  assert.equal(device(world, units.find((u) => u.fixture === RECENT).mac).name, 'Gree Salon');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  // Nothing is sent to Gladys for a device the user has not added.
  assert.equal(world.fake.states.length, 0);
});

test('/data keeps the keys (mode 600): a restart talks to the units without pairing again', async (t) => {
  const unit = new FakeGree(RECENT, '192.0.2.10');
  const first = await createWorld({ units: [unit] });
  await first.app.stop();
  const path = join(first.dataDir, 'gree-state.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(Object.keys(saved.units), [unit.mac]);
  assert.equal(saved.units[unit.mac].key, unit.key);
  assert.equal(saved.units[unit.mac].cipher, 'gcm');
  assert.equal(statSync(path).mode & 0o777, 0o600);

  const second = await createWorld({ units: [unit], dataDir: first.dataDir, scan: false });
  t.after(() => second.app.stop());
  assert.equal(unit.count('bind'), 1, 'no second pairing');
  assert.equal(second.fake.discoveredDevices.length, 1);
});

test('a typed address finds a unit the broadcast misses', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.40');
  const world = await createWorld({
    units: [unit],
    scan: false,
    config: { hosts: '192.0.2.40, nope', language: 'en' },
  });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(unit.count('scan'), 1, 'one unicast scan');
  const ack = await world.fake.action('search', {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /1 air conditioner\(s\), 1 answering: Gree 000001 \(192\.0\.2\.40\)/,
  );
  assert.match(ack.data.message.fr, /Adresses ignorées : nope/);
});

test('added devices get every state at once, then only the changes, with a heartbeat', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.POWER), 1);
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.MODE), AC_MODE.COOLING);
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.TARGET), 24);
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.INDOOR), 25);
  const count = world.fake.states.length;
  const publish = t.mock.method(world.gladys, 'publishChangedStates');
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, count, 'nothing changed, nothing sent');
  assert.ok(publish.mock.calls[0].arguments[1].heartbeat <= 12 * 3600_000);

  unit.props.TemSen = 67;
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, count + 1);
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.INDOOR), 27);
});

test('commands from Gladys: one unit, the right properties, the state at once', async (t) => {
  const unit = new FakeGree(RECENT, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  const dev = { external_id: deviceId(world.gladys, unit.mac) };
  const set = async (key, value) => {
    const ack = await world.fake.setValue(dev, feature(world, unit.mac, key), value);
    assert.equal(ack.success, true, ack.error);
  };
  await set(FEATURE_KEYS.MODE, AC_MODE.COOLING);
  assert.equal(unit.props.Mod, 1);
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.MODE), AC_MODE.COOLING);
  await set(FEATURE_KEYS.TARGET, 19);
  assert.deepEqual([unit.props.SetTem, unit.props.TemUn, unit.props.TemRec], [19, 0, 0]);
  await set(FEATURE_KEYS.FAN, AC_FAN_SPEED.TURBO);
  assert.deepEqual([unit.props.Tur, unit.props.Quiet], [1, 0]);
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.FAN), AC_FAN_SPEED.TURBO);
  await set(FEATURE_KEYS.POWER, 0);
  assert.equal(unit.props.Pow, 0);
  // The default beep: nothing about the buzzer is sent.
  assert.ok(unit.requests('cmd').every((cmd) => !cmd.opt.some((name) => /Buzzer/.test(name))));
  // No trigger for what Gladys did.
  await world.hub.pollAll();
  await world.hub.idle();
  assert.equal(world.fake.sceneEvents.length, 0);
});

test('silent commands ask both generations of firmware not to beep', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit], config: { beep: 'off' } });
  const dev = { external_id: deviceId(world.gladys, unit.mac) };
  await world.fake.setValue(dev, feature(world, unit.mac, FEATURE_KEYS.LIGHT), 0);
  const [cmd] = unit.requests('cmd');
  assert.deepEqual(cmd.opt, ['Lig', 'Buzzer_ON_OFF', 'BuzzerCtrl']);
  assert.deepEqual(cmd.p, [0, 1, 0]);
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.LIGHT), 0);
});

test('the trigger: remote control changes, with what changed, never twice', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  unit.props.Pow = 0;
  await world.hub.pollAll();
  unit.props.Pow = 1;
  unit.props.Mod = 4;
  unit.props.SetTem = 21;
  await world.hub.pollAll();
  unit.props.SetTem = 22;
  await world.hub.pollAll();
  unit.props.WdSpd = 2; // the fan speed alone is not a change of settings
  await world.hub.pollAll();
  await world.hub.pollAll();
  await world.hub.idle();
  const events = world.fake.sceneEvents.map((event) => {
    assert.equal(event.key, TRIGGER);
    return event.data;
  });
  const id = deviceId(world.gladys, unit.mac);
  assert.deepEqual(events, [
    {
      device: id,
      change: 'turned_off',
      power: 'off',
      mode: 'cool',
      target_temperature: 24,
      indoor_temperature: 25,
    },
    {
      device: id,
      change: 'turned_on',
      power: 'on',
      mode: 'heat',
      target_temperature: 21,
      indoor_temperature: 25,
    },
    {
      device: id,
      change: 'settings',
      power: 'on',
      mode: 'heat',
      target_temperature: 22,
      indoor_temperature: 25,
    },
  ]);
});

test('a reading started before a command is dropped', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  const dev = { external_id: deviceId(world.gladys, unit.mac) };
  unit.props.SetTem = 28; // changed on the remote, read by the poll below
  const poll = world.hub.pollAll();
  await world.fake.setValue(dev, feature(world, unit.mac, FEATURE_KEYS.TARGET), 20);
  await poll;
  await world.hub.idle();
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.TARGET), 20);
});

test('a unit off the network: unreachable after two polls, its states kept, back later', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  const transport = () => world.fake.transports.at(-1);
  assert.equal(transport().transport, 'local');
  unit.online = false;
  await world.hub.pollAll();
  assert.equal(transport().transport, 'local', 'one miss is not enough');
  await world.hub.pollAll();
  await world.hub.idle();
  assert.equal(transport().transport, 'unreachable');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.POWER), 1, 'the last state stays');

  const dev = { external_id: deviceId(world.gladys, unit.mac) };
  const ack = await world.fake.setValue(dev, feature(world, unit.mac, FEATURE_KEYS.POWER), 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /does not answer/);

  unit.online = true;
  await world.hub.pollAll();
  assert.equal(transport().transport, 'local');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a unit paired again in the Gree+ app (new key): bound again by itself', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  unit.reset();
  unit.props.SetTem = 27;
  await world.hub.pollAll();
  assert.equal(unit.count('bind'), 2);
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.TARGET), 27);
  await world.hub.store.flush();
  const saved = JSON.parse(await readFile(join(world.dataDir, 'gree-state.json'), 'utf8'));
  assert.equal(saved.units[unit.mac].key, unit.key);
  // A command after a reset works the same way.
  unit.reset();
  const dev = { external_id: deviceId(world.gladys, unit.mac) };
  const ack = await world.fake.setValue(dev, feature(world, unit.mac, FEATURE_KEYS.POWER), 0);
  assert.equal(ack.success, true, ack.error);
  assert.equal(unit.props.Pow, 0);
});

test('a unit with a new address (DHCP) is followed by the next scan', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  unit.host = '192.0.2.77';
  world.fake.scanResults['udp-active-broadcast'] = world.network.scanReplies();
  await world.hub.rediscover();
  assert.equal(world.hub.records.get(unit.mac).host, '192.0.2.77');
  assert.deepEqual(device(world, unit.mac).params[0], { name: 'IP_ADDRESS', value: '192.0.2.77' });
  unit.props.SetTem = 18;
  await world.hub.pollAll();
  assert.equal(lastState(world, unit.mac, FEATURE_KEYS.TARGET), 18);
});

test('a unit refusing the pairing is reported, not published', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  unit.refuseBind = true;
  const world = await createWorld({ units: [unit] });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 0);
  const ack = await world.fake.action('search', {});
  assert.match(ack.data.message.en, /Gree 000001 \(192\.0\.2\.10, refuses the pairing\)/);
  assert.equal(world.fake.connectionStatus.connected, false);
});

test('a sensor that answers late adds its feature (offered as an update)', async (t) => {
  const unit = new FakeGree(NO_SENSOR, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  const keys = () => device(world, unit.mac).features.map((f) => f.external_id.split(':').pop());
  assert.ok(!keys().includes(FEATURE_KEYS.INDOOR));
  unit.props.TemSen = 61;
  await world.hub.pollAll();
  assert.ok(keys().includes(FEATURE_KEYS.INDOOR));
});

test("the core's poll is a fallback: skipped while the timer reads the unit", async (t) => {
  let now = 1_000_000;
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit], now: () => now });
  const dev = world.fake.discoveredDevices[0];
  await world.hub.pollAll();
  const reads = unit.count('status');
  now += 10_000;
  assert.deepEqual(await world.fake.poll(dev), { success: true });
  assert.equal(unit.count('status'), reads, 'read 10 s ago by the timer');
  now += 30_000;
  await world.fake.poll(dev);
  assert.equal(unit.count('status'), reads + 1, 'the timer stalled: the core reads');
  now += 5_000;
  await world.hub.pollAll();
  assert.equal(unit.count('status'), reads + 1, 'the timer skips what the core just read');
});

test('only the units added to Gladys are read', async (t) => {
  const units = [new FakeGree(CLASSIC, '192.0.2.10'), new FakeGree(RECENT, '192.0.2.11')];
  const world = await createWorld({ units });
  t.after(() => world.app.stop());
  await world.fake.deviceCreated(device(world, units[0].mac));
  const before = units.map((unit) => unit.count('status'));
  await world.hub.pollAll();
  assert.deepEqual(
    units.map((unit, index) => unit.count('status') - before[index]),
    [1, 0],
  );
});

test('a new configuration renames nothing created, but republishes in the new language', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  await world.fake.configUpdated({ language: 'de' });
  const names = device(world, unit.mac).features.map((f) => f.name);
  assert.ok(names.includes('Solltemperatur'));
});

test('a reconnection to Gladys re-sends every state', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await created(t, { units: [unit] });
  const count = world.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  await world.hub.idle();
  assert.ok(world.fake.states.length >= count + 4);
});

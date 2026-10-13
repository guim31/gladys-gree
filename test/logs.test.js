// -----------------------------------------------------------------------------
// What the container writes at the default level (info): the life of the
// units and of Gladys, never one line per reading, a repeated failure once,
// and never a key. Also: the hub reads the units by its own timer, without
// onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import {
  CLASSIC,
  FakeGree,
  RECENT,
  createAll,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

/** Everything written on stdout and stderr while `fn` runs, at `level`. */
async function capture(t, fn, level = 'info') {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = previous;
  }
  return lines;
}

async function createdWorld(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const lastState = (world, unit, key) =>
  world.fake.lastState(featureId(world.gladys, unit.mac, key));

test('logs: normal readings, with changes, write nothing at the info level', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await createdWorld(t, { units: [unit] });
  const lines = await capture(t, async () => {
    for (const temperature of [64, 65, 66, 66]) {
      unit.props.TemSen = temperature;
      await world.hub.pollAll();
    }
    await world.hub.rediscover();
    await world.hub.idle();
  });
  assert.equal(lastState(world, unit, FEATURE_KEYS.INDOOR), 26);
  assert.deepEqual(lines, []);
});

test('logs: one line per command of the user, nothing else', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await createdWorld(t, { units: [unit] });
  const device = { external_id: deviceId(world.gladys, unit.mac) };
  const lines = await capture(t, async () => {
    await world.fake.setValue(
      device,
      { external_id: featureId(world.gladys, unit.mac, FEATURE_KEYS.TARGET) },
      23,
    );
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[INFO\].*Gree 000001: target-temperature set to 23/);
});

test('logs: no key ever, even at the debug level (discovery, pairing, readings, a new pairing)', async (t) => {
  const units = [new FakeGree(CLASSIC, '192.0.2.10'), new FakeGree(RECENT, '192.0.2.11')];
  let world;
  const lines = await capture(
    t,
    async () => {
      world = await createdWorld(t, { units, config: { language: 'en' } });
      units[0].reset();
      await world.hub.pollAll();
      await world.hub.rediscover();
      await world.hub.idle();
    },
    'debug',
  );
  assert.ok(lines.length > 0, 'the debug level writes something');
  assert.equal(units[0].count('bind'), 2, 'paired again during the capture');
  const text = lines.join('\n');
  for (const unit of units) {
    assert.ok(!text.includes(unit.key), 'a unit key reached the logs');
  }
  for (const generic of ['a3K8Bx%2r8Y7#xDh', '{yxAHAY_Lm6pbC/<']) {
    assert.ok(!text.includes(generic));
  }
});

test('logs: Gladys refusing the states at every reading is said once, and its return once', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await createdWorld(t, { units: [unit] });
  const refusal = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new GladysApiError(503, 'SERVICE_UNAVAILABLE', 'Gladys is restarting');
  });
  const failing = await capture(t, async () => {
    for (const temperature of [61, 62, 63, 64]) {
      unit.props.TemSen = temperature;
      await world.hub.pollAll();
    }
    await world.hub.idle();
  });
  assert.equal(failing.length, 1, failing.join('\n'));
  assert.match(failing[0], /\[WARN\].*Gladys does not take the Gree updates: Gladys is restarting/);

  refusal.mock.restore();
  const back = await capture(t, async () => {
    await world.hub.pollAll();
    await world.hub.pollAll();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Gladys takes the Gree updates again/);
  assert.equal(lastState(world, unit, FEATURE_KEYS.INDOOR), 24);
});

test('logs: a unit lost and back is said once each way', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await createdWorld(t, { units: [unit] });
  unit.online = false;
  const lost = await capture(t, async () => {
    for (let poll = 0; poll < 5; poll += 1) {
      await world.hub.pollAll();
    }
    await world.hub.idle();
  });
  assert.equal(lost.length, 1, lost.join('\n'));
  assert.match(lost[0], /\[INFO\].*Gree 000001 no longer answers at 192\.0\.2\.10/);

  unit.online = true;
  const back = await capture(t, async () => {
    await world.hub.pollAll();
    await world.hub.pollAll();
  });
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Gree 000001 answers at 192\.0\.2\.10/);
});

test('logs: a core without the active scan is said once; a busy scan is not a warning', async (t) => {
  const world = await createdWorld(t);
  const scan = t.mock.method(world.gladys, 'scanNetwork', async () => {
    throw new GladysApiError(403, 'FORBIDDEN', 'network_discovery not declared');
  });
  const refused = await capture(t, async () => {
    for (let round = 0; round < 3; round += 1) {
      await world.hub.track(world.hub.rediscover());
    }
  });
  assert.equal(refused.length, 1, refused.join('\n'));
  assert.match(refused[0], /\[WARN\].*Gree discovery through Gladys failed/);

  scan.mock.mockImplementation(async () => {
    throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'A scan ran less than 10 s ago');
  });
  const busy = await capture(t, async () => {
    await world.hub.track(world.hub.rediscover());
  });
  assert.deepEqual(busy, []);
  assert.equal(world.hub.summary().scan, 'busy');
});

test('logs: a bug in a background task is logged with its stack, not hidden', async (t) => {
  const world = await createdWorld(t);
  t.mock.method(world.hub, 'publishTransports', async () => {
    throw new RangeError('a bug');
  });
  const lines = await capture(t, async () => {
    await world.hub.track(world.hub.rediscover());
  });
  const text = lines.join('\n');
  assert.match(text, /\[ERROR\].*Background task failed/);
  assert.match(text, /RangeError: a bug\n\s+at /);
});

test('polling: the hub reads by its own timer, without any onPoll', async (t) => {
  // Only the intervals are simulated: the UDP retries keep their real timers.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await createdWorld(t, { units: [unit], timers: true });
  const polls = t.mock.method(world.hub, 'onPoll');
  const reads = unit.count('status');

  unit.props.SetTem = 19;
  t.mock.timers.tick(29_000);
  await world.hub.idle();
  assert.equal(unit.count('status'), reads, 'not before the interval (30 s by default)');
  t.mock.timers.tick(1_000);
  await world.hub.idle();
  assert.equal(unit.count('status'), reads + 1);
  assert.equal(lastState(world, unit, FEATURE_KEYS.TARGET), 19);
  assert.equal(polls.mock.callCount(), 0);
});

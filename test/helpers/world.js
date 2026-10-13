// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Gree units on a fake UDP
// network, and a temporary /data, with the integration wired on top through
// registerHandlers. No timer runs unless asked: the tests read the units with
// `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FIXTURE_NAMES, FakeGree, createNetwork } from './fakeGree.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// Fast retries: a unit that does not answer fails in 60 ms.
export const FAST_TRANSPORT = {
  timeoutMs: 60,
  commandTimeoutMs: 60,
  firstRetryMs: 20,
  maxRetryMs: 20,
};

export const CLASSIC = 'ecb-v1.2-sensor-offset';
export const RECENT = 'gcm-v3.3-no-offset';
export const NO_SENSOR = 'ecb-v1.0-no-sensor';
export const FAHRENHEIT = 'ecb-fahrenheit-display';

/** One fake unit per fixture, at 192.0.2.10, .11... */
export function allUnits() {
  return FIXTURE_NAMES.map((name, index) => new FakeGree(name, `192.0.2.${10 + index}`));
}

/**
 * @param {object} [options]
 * @param {FakeGree[]} [options.units] the fake units of the network
 * @param {boolean} [options.scan] whether the core's discovery finds them
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.created] devices already created in Gladys
 * @param {boolean} [options.timers] the hub's own timers (off: the tests poll)
 * @param {() => number} [options.now] the hub's clock
 */
export async function createWorld({
  units = [new FakeGree(CLASSIC, '192.0.2.10')],
  scan = true,
  config = { language: 'en' },
  created = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-gree-')),
  timings = {},
  timers = false,
  now,
} = {}) {
  const network = createNetwork(units);
  const gladys = createFakeGladys({
    config,
    devices: created,
    // Read at each scan: a unit taken offline or moved is seen as such.
    scanResults: {
      get 'udp-active-broadcast'() {
        return scan ? network.scanReplies() : [];
      },
    },
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    createSocket: network.createSocket,
    timers,
    timings,
    transportTimings: FAST_TRANSPORT,
    now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, app, hub: app.hub, dataDir };
}

export const deviceId = (gladys, mac) => gladys.externalIds('gree', mac).device;
export const featureId = (gladys, mac, key) => gladys.externalIds('gree', mac).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await world.hub.idle();
}

export { FakeGree };

// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/fixtures/gree): a classic ECB unit with every function, a
// recent GCM unit without offset on its sensor, an older unit without sensor
// nor optional functions, a unit displaying Fahrenheit — in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIXTURE_NAMES } from './helpers/fakeGree.js';
import { allUnits, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'default configuration (French names)', config: {} },
  { label: 'English names', config: { language: 'en' } },
  { label: 'German names', config: { language: 'de' } },
  { label: 'Spanish names', config: { language: 'es' } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { fake, app } = await createWorld({ units: allUnits(), config: scenario.config });
    try {
      const devices = fake.discoveredDevices;
      assert.equal(devices.length, FIXTURE_NAMES.length, 'one device per fixture');

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          for (const option of feature.supported_options ?? []) {
            // t_device_feature_supported_option: an integer value, a label.
            assert.ok(Number.isInteger(option.value), `${at}: option value must be an integer`);
            assert.ok(option.value >= feature.min && option.value <= feature.max, `${at}: option`);
            assert.ok(typeof option.label === 'string' && option.label !== '', `${at}: label`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await app.stop();
    }
  });
}

test('every state published for the fixtures is a number within its feature bounds', async () => {
  const { fake, app, hub } = await createWorld({ units: allUnits() });
  try {
    for (const device of fake.discoveredDevices) {
      await fake.deviceCreated(device);
    }
    await hub.idle();
    const features = new Map(
      fake.discoveredDevices.flatMap((device) => device.features.map((f) => [f.external_id, f])),
    );
    assert.ok(fake.states.length >= 30);
    for (const state of fake.states) {
      const feature = features.get(state.device_feature_external_id);
      assert.ok(feature, `${state.device_feature_external_id}: no such feature`);
      assert.equal(typeof state.state, 'number', `${feature.name}: numeric state`);
      assert.ok(
        state.state >= feature.min && state.state <= feature.max,
        `${feature.name}: ${state.state} outside ${feature.min}..${feature.max}`,
      );
      for (const option of feature.supported_options ?? []) {
        assert.ok(Number.isInteger(option.value));
      }
      if (feature.supported_options) {
        assert.ok(
          feature.supported_options.some((option) => option.value === state.state),
          `${feature.name}: ${state.state} is not one of its options`,
        );
      }
    }
  } finally {
    await app.stop();
  }
});

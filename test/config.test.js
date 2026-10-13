import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('defaults: no address, 30 s, the usual beep, French names', () => {
  assert.deepEqual(normalizeConfig(), {
    hosts: [],
    invalidHosts: [],
    pollSeconds: 30,
    beep: true,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(null), normalizeConfig(DEFAULT_CONFIG));
});

test('addresses: separators, duplicates, leading zeros, invalid entries', () => {
  assert.deepEqual(parseHosts('192.0.2.10, 192.0.2.011;192.0.2.12\n192.0.2.10 nope 300.1.1.1'), {
    hosts: ['192.0.2.10', '192.0.2.11', '192.0.2.12'],
    invalid: ['nope', '300.1.1.1'],
  });
  assert.deepEqual(parseHosts(undefined), { hosts: [], invalid: [] });
});

test('values outside the lists fall back to the defaults', () => {
  const config = normalizeConfig({ poll_interval: '7', language: 'it', beep: 'off' });
  assert.equal(config.pollSeconds, 30);
  assert.equal(config.language, 'fr');
  assert.equal(config.beep, false);
  assert.equal(normalizeConfig({ poll_interval: 10 }).pollSeconds, 10);
});

// -----------------------------------------------------------------------------
// The Gree hub: finds the units, binds them, reads them at the configured
// pace, publishes their devices and states to Gladys, runs the commands and
// fires the scene trigger.
//
// Polling only: a Gree unit never pushes its changes (remote control, Gree+
// app). The core cannot be trusted to poll either (GladysAssistant/Gladys#3198:
// a device created without `should_poll` is never polled, and keeps it), so
// the hub reads the units the user added by its own timer, every 30 s by
// default. The core's onPoll stays as a fallback and is skipped while the
// timer runs.
// -----------------------------------------------------------------------------

import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import {
  AC_MODE,
  FEATURE_KEYS,
  MODE_WORDS,
  buildDevice,
  capabilitiesOf,
  commandFor,
  deviceIds,
  deviceName,
  deviceValues,
  fanCommand,
  featureSpecs,
  gladysMode,
  greeMode,
  sameCapabilities,
  targetCommand,
} from './devices.js';
import { mapLimit, parseScanReplies, scanRequest } from './discovery.js';
import {
  PROPS,
  STATUS_COLS,
  firmwareVersion,
  indoorTemperature,
  normalizeMac,
} from './gree/protocol.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, errorText } from './texts.js';

const logger = createLogger({ name: 'gree-hub' });

export const WIDGET_KEY = 'overview';
export const TRIGGER = 'changed_outside_gladys';
// What changed, for the trigger `change` filter.
export const CHANGES = {
  TURNED_ON: 'turned_on',
  TURNED_OFF: 'turned_off',
  SETTINGS: 'settings',
};

export const HUB_TIMINGS = {
  // New scan, to follow DHCP changes and find new units.
  rediscoveryMs: 15 * 60_000,
  // Earliest new scan after a unit stopped answering (it may have moved).
  lostRescanMs: 5 * 60_000,
  // Polls in a row without answer before a unit is "unreachable".
  unreachableAfter: 2,
  // An unchanged value is published again at least this often, so Gladys
  // never shows "no recent value" (it does after 48 h).
  heartbeatMs: 6 * 60 * 60_000,
};

// The timer skips a unit read less than half a period ago (by the core's
// onPoll); onPoll skips one read less than 90 % of a period ago.
const TIMER_MIN_GAP = 0.5;
const ONPOLL_MIN_GAP = 0.9;

const PROBE_CONCURRENCY = 8;
const POLL_CONCURRENCY = 8;
// Changes of these features change what the widget shows.
const WIDGET_KEYS = [
  FEATURE_KEYS.POWER,
  FEATURE_KEYS.MODE,
  FEATURE_KEYS.TARGET,
  FEATURE_KEYS.INDOOR,
];
// Properties firmware older than the status command may lack: read once.
const PROBE_COLS = [PROPS.FIRMWARE];

/**
 * Gladys refused a call or did not answer (restart, network, rate limit): a
 * passing condition, unlike a bug in the integration.
 */
const isGladysFailure = (err) =>
  err instanceof GladysApiError ||
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError' ||
  (err instanceof TypeError && err.message === 'fetch failed');

/** "fetch failed (ECONNREFUSED)": the low-level code Node hides in `cause`. */
const describe = (err) => {
  const code = err?.cause?.code;
  return code && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
};

const isGiven = (value) => value !== undefined && value !== null && String(value).trim() !== '';

export class GreeHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {object} options.transport GreeTransport
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, transport, timers = true, timings, now = () => Date.now() }) {
    this.gladys = gladys;
    this.store = store;
    this.transport = transport;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now;
    this.config = null;
    /** @type {Map<string, object>} bound units, by MAC address */
    this.records = new Map();
    /** @type {Map<string, object>} units found that refuse the binding, by MAC */
    this.unbound = new Map();
    this.pending = new Set();
    this.pollTimer = null;
    this.rediscoveryTimer = null;
    this.polling = null;
    this.discovering = null;
    this.lastScan = { status: 'not-run', found: 0 };
    this.lastLostRescan = 0;
    this.stopped = false;
    // Repeated failures (Gladys refusing, a unit answering errors): one line
    // when they start and one when they end.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.restore();
    await this.discover();
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    this.startTimers();
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    for (const record of this.records.values()) {
      record.published = {};
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
    this.requestWidgetRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (!previous || previous.hosts.join(',') !== config.hosts.join(',')) {
      await this.discover();
    }
    if (previous && previous.pollSeconds !== config.pollSeconds) {
      this.startTimers();
    }
    // New units, or names in another language for the Discovery list.
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  startTimers() {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    this.pollTimer = setInterval(() => this.track(this.pollAll()), this.config.pollSeconds * 1000);
    this.rediscoveryTimer = setInterval(
      () => this.track(this.rediscover()),
      this.timings.rediscoveryMs,
    );
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.rediscoveryTimer);
    await this.idle();
    this.transport.close();
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => this.backgroundFailed(err))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  /**
   * A periodic task failed. Gladys refusing or away is said once until it
   * accepts again; a bug is logged with its stack, once per message.
   */
  backgroundFailed(err) {
    if (isGladysFailure(err)) {
      this.problems.fail('gladys', `Gladys does not take the Gree updates: ${describe(err)}`);
    } else {
      this.problems.fail(`bug:${err?.message}`, 'Background task failed', 'error', err);
    }
  }

  gladysRecovered() {
    this.problems.recover('gladys', 'Gladys takes the Gree updates again');
  }

  /** Resolves once no background work is left. */
  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  async restore() {
    const data = await this.store.load();
    for (const [key, saved] of Object.entries(data.units ?? {})) {
      const mac = normalizeMac(key);
      if (
        !mac ||
        !saved ||
        typeof saved.host !== 'string' ||
        typeof saved.key !== 'string' ||
        !['ecb', 'gcm'].includes(saved.cipher)
      ) {
        continue;
      }
      const record = this.createRecord({ mac, host: saved.host, name: saved.name ?? '' });
      Object.assign(record, {
        cipher: saved.cipher,
        key: saved.key,
        firmware: typeof saved.firmware === 'string' ? saved.firmware : null,
        caps: capabilitiesOf({}, saved.caps ?? {}),
      });
      this.records.set(mac, record);
    }
  }

  save() {
    const units = {};
    for (const record of this.records.values()) {
      units[record.mac] = {
        host: record.host,
        name: record.name,
        cipher: record.cipher,
        key: record.key,
        firmware: record.firmware,
        caps: record.caps,
      };
    }
    return this.store.save({ units });
  }

  // --- Discovery -------------------------------------------------------------

  createRecord({ mac, host, name }) {
    return {
      mac,
      host,
      name,
      cipher: null,
      key: null,
      firmware: null,
      caps: capabilitiesOf({}),
      props: null,
      // null until the first answer or the first scan without one.
      reachable: null,
      failures: 0,
      // Bumped on every command: a poll started before it is stale.
      commandSeq: 0,
      // When the unit was last read, and last read by the core's poll.
      lastReadAt: null,
      lastCoreReadAt: null,
      // Last values published, by feature key (for the widget nudges).
      published: {},
    };
  }

  /**
   * Scan through the Gladys core, then probe the typed, found and known
   * addresses. Resolves with the number of units answering.
   */
  discover() {
    this.discovering ??= this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  async runDiscovery() {
    // Priority when one unit answers on several addresses: the typed one,
    // then the one the scan found, then the one known from before.
    const targets = new Map();
    const add = (host, info = null) => {
      if (!targets.has(host)) {
        targets.set(host, info);
      } else if (info && !targets.get(host)) {
        targets.set(host, info);
      }
    };
    const found = await this.scan();
    this.config.hosts.forEach((host) => add(host));
    found.forEach((info) => add(info.host, info));
    [...this.records.values()].forEach((record) => add(record.host));

    const hosts = [...targets.keys()];
    const results = await mapLimit(hosts, PROBE_CONCURRENCY, (host) =>
      this.probe(host, targets.get(host)),
    );
    const answers = new Map();
    const refusing = new Map();
    results.forEach((result, index) => {
      if (result.error) {
        logger.debug(`No Gree answer from ${hosts[index]}: ${result.error.message}`);
      } else if (result.value.refused) {
        refusing.set(result.value.info.mac, { host: hosts[index], ...result.value.info });
      } else if (!answers.has(result.value.info.mac)) {
        answers.set(result.value.info.mac, result.value);
      }
    });
    for (const answer of answers.values()) {
      const record = this.adopt(answer);
      await this.applyReading(record, answer.props);
    }
    for (const [mac, info] of refusing) {
      if (!answers.has(mac)) {
        if (!this.unbound.has(mac)) {
          logger.warn(`Gree unit ${mac} at ${info.host} answers but refuses the pairing`);
        }
        this.unbound.set(mac, info);
      }
    }
    for (const mac of answers.keys()) {
      this.unbound.delete(mac);
    }
    for (const record of this.records.values()) {
      if (!answers.has(record.mac) && record.reachable === null) {
        // Known from /data, silent since the start: unreachable, no event.
        record.reachable = false;
      }
    }
    await this.save();
    return answers.size;
  }

  /** One scan broadcast through the Gladys core: `[{ host, mac, ... }]`. */
  async scan() {
    try {
      const found = parseScanReplies(
        await this.gladys.scanNetwork('udp-active-broadcast', scanRequest()),
      );
      this.lastScan = { status: 'ok', found: found.length };
      this.problems.recover('scan', 'Gree discovery through Gladys works again');
      return found;
    } catch (err) {
      // 403: a core without mediated discovery; 429 or 409: a scan ran less
      // than 10 s ago. The typed and known addresses still work.
      // Said once, not at every rediscovery; "busy" passes by itself.
      const status = err.status === 429 || err.status === 409 ? 'busy' : 'unavailable';
      const message = `Gree discovery through Gladys failed: ${describe(err)}`;
      if (status === 'busy') {
        logger.debug(message);
      } else {
        this.problems.fail('scan', message);
      }
      this.lastScan = { status, found: 0 };
      return [];
    }
  }

  /**
   * Ask one address what it is, bind it if needed and read it:
   * `{ host, info, cipher, key, props, firmware }`, or `{ refused, info }`
   * when the unit answers the scan but not the binding.
   * @param {string} host
   * @param {object|null} info the scan reply, when the broadcast found it
   */
  async probe(host, info) {
    const unit = info ?? { host, ...(await this.transport.scan(host)) };
    const known = this.records.get(unit.mac);
    let key = known?.key && known.cipher === unit.cipher ? known.key : null;
    let props = null;
    if (key) {
      try {
        props = await this.transport.status(host, { mac: unit.mac, key, cipher: unit.cipher }, [
          ...this.statusCols(),
          ...PROBE_COLS,
        ]);
      } catch (err) {
        if (err.kind === 'socket') {
          throw err;
        }
        // It answered the scan, not the status: it has another key.
        logger.debug(`${host} refuses the known key (${err.message}), binding again`);
        key = null;
      }
    }
    if (!key) {
      try {
        key = await this.transport.bind(host, unit);
      } catch (err) {
        if (err.kind === 'socket') {
          throw err;
        }
        // Refusing is answering the scan, not the binding (a unit that
        // stopped answering altogether is just unreachable).
        await this.transport.scan(host);
        logger.debug(`${host} refuses the binding: ${err.message}`);
        return { refused: true, info: unit };
      }
      props = await this.transport.status(host, { mac: unit.mac, key, cipher: unit.cipher }, [
        ...this.statusCols(),
        ...PROBE_COLS,
      ]);
      if (known) {
        logger.info(`${this.label(known)} paired again`);
      }
    }
    return {
      host,
      info: unit,
      cipher: unit.cipher,
      key,
      props,
      firmware: firmwareVersion(props[PROPS.FIRMWARE]) ?? (unit.version || null),
    };
  }

  /** The status columns: every property the integration reads. */
  statusCols() {
    return STATUS_COLS;
  }

  /** Take a probe answer: a new unit is added, a known one may have moved. */
  adopt(answer) {
    let record = this.records.get(answer.info.mac);
    if (!record) {
      record = this.createRecord({
        mac: answer.info.mac,
        host: answer.host,
        name: answer.info.name,
      });
      this.records.set(record.mac, record);
      logger.info(`Gree air conditioner ${record.mac} found at ${answer.host}`);
    } else if (record.host !== answer.host) {
      logger.info(`${this.label(record)} moved from ${record.host} to ${answer.host}`);
    }
    Object.assign(record, {
      host: answer.host,
      name: answer.info.name || record.name,
      cipher: answer.cipher,
      key: answer.key,
      firmware: answer.firmware ?? record.firmware,
    });
    return record;
  }

  async rediscover() {
    await this.discover();
    // New units, and new addresses (DHCP) for the params of the created
    // devices.
    await this.publishDevices();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
  }

  // --- Devices ---------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record, this.config.language),
    );
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** The record behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    const prefix = deviceIds(this.gladys, '').device;
    if (!externalId.startsWith(prefix)) {
      return null;
    }
    return this.records.get(externalId.slice(prefix.length)) ?? null;
  }

  createdDevice(record) {
    const id = deviceIds(this.gladys, record.mac).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === id) ?? null;
  }

  isCreated(record) {
    return this.createdDevice(record) !== null;
  }

  /** The units the user added to Gladys. */
  createdRecords() {
    return [...this.records.values()].filter((record) => this.isCreated(record));
  }

  require(externalId) {
    const record = this.resolveDevice(externalId);
    if (!record) {
      throw new Error(errorText('unknown', this.config?.language));
    }
    return record;
  }

  // --- States ----------------------------------------------------------------

  /**
   * Publish what changed for one unit, if the user created it (Gladys caps
   * states at 300 a minute and re-evaluates scenes on each one), and every
   * value again after the heartbeat delay. Resolves with the keys that changed.
   */
  async publishStates(record) {
    if (!record.props || !this.isCreated(record)) {
      return [];
    }
    const ids = deviceIds(this.gladys, record.mac);
    const values = deviceValues(record);
    const states = [];
    const changed = [];
    for (const spec of featureSpecs(record.caps, this.config.language)) {
      const value = values[spec.key];
      if (value === undefined) {
        continue;
      }
      states.push({ device_feature_external_id: ids.feature(spec.key), state: value });
      if (record.published[spec.key] !== value) {
        changed.push(spec.key);
      }
    }
    // The SDK sends only the values that changed since its last publication,
    // and the unchanged ones once the heartbeat delay has passed.
    await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
    for (const key of changed) {
      record.published[key] = values[key];
    }
    return changed;
  }

  async publishAllStates() {
    for (const record of this.records.values()) {
      try {
        await this.publishStates(record);
      } catch (err) {
        logger.debug(`Cannot publish the states of ${record.mac}: ${err.message}`);
        this.backgroundFailed(err);
      }
    }
  }

  /**
   * The user added a device: the states sent before were dropped by Gladys,
   * and so was the transport badge. Send them again, nudge the widget.
   */
  async onDeviceCreated(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      return;
    }
    record.published = {};
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates(record);
    await this.publishTransports([record]);
    this.requestWidgetRefresh();
  }

  async publishTransports(records = [...this.records.values()]) {
    const entries = records
      .filter((record) => this.isCreated(record))
      .map((record) => ({
        external_id: deviceIds(this.gladys, record.mac).device,
        transport: record.reachable === true ? 'local' : 'unreachable',
      }));
    for (let at = 0; at < entries.length; at += 100) {
      await this.gladys.publishTransports(entries.slice(at, at + 100));
    }
  }

  async publishConnectionStatus() {
    const records = [...this.records.values()];
    if (records.length === 0) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noDevice);
    } else if (!records.some((record) => record.reachable === true)) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noAnswer);
    } else {
      await this.gladys.setConnectionStatus(true);
    }
  }

  requestWidgetRefresh() {
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Polling -----------------------------------------------------------------

  /** Read every unit the user added (the timer's job). */
  pollAll() {
    this.polling ??= mapLimit(this.createdRecords(), POLL_CONCURRENCY, (record) =>
      // Skipped only when the core's poll read the unit just before.
      this.refresh(record, { since: record.lastCoreReadAt, minGap: TIMER_MIN_GAP }),
    )
      .then((results) => {
        // A unit that does not answer is handled by refresh; what is left
        // is Gladys refusing the states (or a bug).
        const errors = results.filter((result) => result.error).map((result) => result.error);
        errors.forEach((err) => this.backgroundFailed(err));
        if (errors.length === 0) {
          this.gladysRecovered();
        }
      })
      .finally(() => {
        this.polling = null;
      });
    return this.polling;
  }

  /** The core's poll: a fallback, skipped while the timer reads the unit. */
  async onPoll(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      return;
    }
    const read = await this.refresh(record, { since: record.lastReadAt, minGap: ONPOLL_MIN_GAP });
    if (read) {
      record.lastCoreReadAt = record.lastReadAt;
    }
  }

  /**
   * Read one unit and publish what changed. Skipped (resolves false) when
   * `since` is less than `minGap` polling periods ago.
   */
  async refresh(record, { since = null, minGap = 0 } = {}) {
    const periodMs = this.config.pollSeconds * 1000;
    if (typeof since === 'number' && this.now() - since < periodMs * minGap) {
      return false;
    }
    record.lastReadAt = this.now();
    const seq = record.commandSeq;
    let props;
    try {
      props = await this.readStatus(record);
    } catch (err) {
      if (err.unreachable) {
        await this.failed(record);
      } else {
        this.problems.fail(
          `read:${record.mac}`,
          `Cannot read ${this.label(record)}: ${err.message}`,
        );
      }
      return true;
    }
    this.problems.recover(`read:${record.mac}`, `${this.label(record)} reads again`);
    if (seq !== record.commandSeq) {
      // A Gladys command ran meanwhile: this reading may predate it.
      return true;
    }
    await this.applyReading(record, props);
    return true;
  }

  /** Status read, binding again once when the unit has another key. */
  readStatus(record) {
    return this.withKey(record, () =>
      this.transport.status(record.host, record, this.statusCols()),
    );
  }

  /**
   * Run an exchange with the unit's key; when it fails because the unit has
   * another key (reset, paired again in the Gree+ app), bind again and retry
   * once. Some firmware answers with its new key (`bad-key`), some ignores
   * the request: a timeout from a unit that still answers the scan is the
   * same case.
   */
  async withKey(record, exchange) {
    try {
      return await exchange();
    } catch (err) {
      if (!(await this.recoverKey(record, err))) {
        throw err;
      }
      return exchange();
    }
  }

  async recoverKey(record, err) {
    if (err.kind !== 'bad-key' && err.kind !== 'timeout') {
      return false;
    }
    let info;
    try {
      info = await this.transport.scan(record.host);
    } catch {
      return false;
    }
    if (info.mac !== record.mac) {
      // Another unit took the address (DHCP): the rediscovery sorts it out.
      return false;
    }
    record.key = await this.transport.bind(record.host, info);
    record.cipher = info.cipher;
    logger.info(`${this.label(record)} paired again`);
    await this.save();
    return true;
  }

  /**
   * A fresh status (or what a command applied): publish what changed, follow
   * the reachability and the capabilities, fire the trigger when the unit
   * was changed outside Gladys.
   */
  async applyReading(record, props, { own = false } = {}) {
    const before = record.props;
    record.props = { ...(record.props ?? {}), ...props };
    delete record.props[PROPS.FIRMWARE];
    record.failures = 0;
    if (record.reachable !== true) {
      record.reachable = true;
      logger.info(`${this.label(record)} answers at ${record.host}`);
      await this.publishTransports([record]);
      await this.publishConnectionStatus();
      this.requestWidgetRefresh();
    }
    const caps = capabilitiesOf(props, record.caps);
    if (!sameCapabilities(caps, record.caps)) {
      // A function seen for the first time (a sensor that answered late):
      // the Discovery tab offers to update the device.
      record.caps = caps;
      if (before !== null) {
        logger.info(`${this.label(record)} has new functions, update it in the Discovery tab`);
        await this.save();
        await this.publishDevices();
      }
    }
    if (!own && before) {
      this.detectOutsideChange(record, before, record.props);
    }
    const changed = await this.publishStates(record);
    if (changed.some((key) => WIDGET_KEYS.includes(key))) {
      this.requestWidgetRefresh();
    }
  }

  /** Fire the trigger when power, mode or setpoint moved without Gladys. */
  detectOutsideChange(record, before, after) {
    const power = (props) =>
      typeof props[PROPS.POWER] === 'number' ? props[PROPS.POWER] > 0 : null;
    const wasOn = power(before);
    const isOn = power(after);
    let change = null;
    if (wasOn !== null && isOn !== null && wasOn !== isOn) {
      change = isOn ? CHANGES.TURNED_ON : CHANGES.TURNED_OFF;
    } else if (
      isOn === true &&
      (before[PROPS.MODE] !== after[PROPS.MODE] || before[PROPS.TARGET] !== after[PROPS.TARGET]) &&
      before[PROPS.MODE] !== undefined &&
      before[PROPS.TARGET] !== undefined
    ) {
      change = CHANGES.SETTINGS;
    }
    if (change === null || !this.isCreated(record)) {
      return;
    }
    const mode = gladysMode(after[PROPS.MODE]);
    this.track(
      this.gladys.publishSceneEvent(TRIGGER, {
        device: deviceIds(this.gladys, record.mac).device,
        change,
        power: isOn ? 'on' : 'off',
        mode: mode === null ? null : MODE_WORDS[mode],
        target_temperature: typeof after[PROPS.TARGET] === 'number' ? after[PROPS.TARGET] : null,
        indoor_temperature: indoorTemperature(after),
      }),
    );
  }

  /**
   * A poll without answer. After a few in a row the unit is unreachable (power
   * cut, Wi-Fi lost, new address): its last states stay, its badge says so,
   * and a new scan looks for it.
   */
  async failed(record) {
    if (this.stopped) {
      return;
    }
    record.failures += 1;
    if (record.failures < this.timings.unreachableAfter) {
      return;
    }
    if (record.reachable !== false) {
      record.reachable = false;
      logger.info(`${this.label(record)} no longer answers at ${record.host}`);
      await this.publishTransports([record]);
      await this.publishConnectionStatus();
      this.requestWidgetRefresh();
    }
    if (this.now() - this.lastLostRescan >= this.timings.lostRescanMs) {
      this.lastLostRescan = this.now();
      this.track(this.rediscover());
    }
  }

  label(record) {
    const device = this.createdDevice(record);
    return device?.name ?? deviceName(record);
  }

  // --- Commands ----------------------------------------------------------------

  /** Send a command, then publish what the unit applied without waiting. */
  async send(record, values) {
    record.commandSeq += 1;
    const sent = { ...values };
    if (this.config.beep === false) {
      // Two generations of firmware, two names for the same wish.
      sent.Buzzer_ON_OFF = 1;
      sent.BuzzerCtrl = 0;
    }
    let applied;
    try {
      applied = await this.sendCommand(record, sent);
    } catch (err) {
      if (err.unreachable) {
        await this.failed(record);
        throw new Error(errorText('unreachable', this.config.language), { cause: err });
      }
      throw err;
    }
    // Only the properties the integration reads: the buzzer ones are not.
    const known = {};
    for (const name of Object.keys(values)) {
      known[name] = typeof applied[name] === 'number' ? applied[name] : values[name];
    }
    await this.applyReading(record, known, { own: true });
  }

  sendCommand(record, values) {
    return this.withKey(record, () => this.transport.command(record.host, record, values));
  }

  /** A Gladys command on a feature of one of the devices. */
  async setValue(device, feature, value) {
    const record = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    const values = commandFor(record, key, value);
    logger.info(`${this.label(record)}: ${key} set to ${value}`);
    await this.send(record, values);
  }

  /**
   * Turn a unit on with a mode, an optional setpoint and fan speed: one
   * command, one beep (the scene action).
   * @returns {object} the record
   */
  async applySettings(deviceExternalId, { mode, target, fan }) {
    const record = this.require(deviceExternalId);
    const gladysModeValue = Number(mode);
    const values = { [PROPS.POWER]: 1, [PROPS.MODE]: greeMode(gladysModeValue) };
    if (isGiven(target) && Number.isFinite(Number(String(target).replace(',', '.')))) {
      Object.assign(values, targetCommand(record.props, Number(String(target).replace(',', '.'))));
    }
    if (isGiven(fan)) {
      Object.assign(values, fanCommand(Number(fan)));
    }
    logger.info(`${this.label(record)}: settings applied (mode ${MODE_WORDS[gladysModeValue]})`);
    await this.send(record, values);
    return record;
  }

  /** Turn a unit on or off (the widget). */
  async switchPower(deviceExternalId, on) {
    const record = this.require(deviceExternalId);
    logger.info(`${this.label(record)}: turned ${on ? 'on' : 'off'}`);
    await this.send(record, { [PROPS.POWER]: on ? 1 : 0 });
  }

  /**
   * Turn off every unit the user added that is on and answering (one that
   * does not answer cannot be reached anyway). Resolves with how many were
   * turned off; fails when one of them could not be.
   */
  async turnOffAll() {
    const on = this.createdRecords().filter(
      (record) => record.reachable === true && record.props?.[PROPS.POWER] > 0,
    );
    logger.info(`Turning off ${on.length} Gree air conditioner(s)`);
    const results = await mapLimit(on, POLL_CONCURRENCY, (record) =>
      this.send(record, { [PROPS.POWER]: 0 }),
    );
    const failure = results.find((result) => result.error);
    if (failure) {
      throw failure.error;
    }
    return on.length;
  }

  /** What the Configuration screen's "Search" action reports. */
  summary() {
    return {
      scan: this.lastScan.status,
      invalidHosts: this.config.invalidHosts,
      devices: [
        ...[...this.records.values()].map((record) => ({
          name: this.label(record),
          host: record.host,
          reachable: record.reachable === true,
          bound: true,
        })),
        ...[...this.unbound.values()].map((info) => ({
          name: deviceName(info),
          host: info.host,
          reachable: true,
          bound: false,
        })),
      ],
    };
  }
}

export { AC_MODE };

// -----------------------------------------------------------------------------
// The Gree Wi-Fi protocol: the messages and the properties of a unit.
//
// JSON datagrams on UDP port 7000. Four exchanges, one reply each:
//
//   scan    {"t":"scan"} in clear, broadcast or unicast → a `pack` "dev"
//           (MAC, name, firmware), encrypted with the generic key;
//   bind    a `pack` "bind" with the generic key → "bindok" with the unit's key;
//   status  a `pack` "status" listing property names (`cols`) → "dat" with
//           their values (`dat`, same order);
//   cmd     a `pack` "cmd" with names (`opt`) and values (`p`) → "res" with
//           the values applied (`val`, or `p` on some firmware).
//
// The property names are the unit's own (`Pow`, `Mod`, `SetTem`...); values
// are integers. Two conversions matter:
//   - `Mod` does not use the order of Gladys (Gree: 0 auto, 1 cool, 2 dry,
//     3 fan, 4 heat);
//   - `TemSen` (indoor temperature) carries an offset of +40 on most firmware,
//     none on some recent ones.
// -----------------------------------------------------------------------------

import { CIPHERS, GENERIC_KEYS, decryptGenericPack, decryptPack, encryptPack } from './crypto.js';

export const GREE_PORT = 7000;

export const PROPS = {
  POWER: 'Pow',
  MODE: 'Mod',
  TARGET: 'SetTem',
  TEMP_UNIT: 'TemUn',
  TEMP_BIT: 'TemRec',
  INDOOR: 'TemSen',
  FAN: 'WdSpd',
  TURBO: 'Tur',
  QUIET: 'Quiet',
  SWING_VERTICAL: 'SwUpDn',
  SWING_HORIZONTAL: 'SwingLfRig',
  LIGHT: 'Lig',
  ECO: 'SvSt',
  FROST_GUARD: 'StHt',
  XFAN: 'Blo',
  SLEEP: 'SwhSlp',
  SLEEP_MODE: 'SlpMod',
  HEALTH: 'Health',
  FIRMWARE: 'hid',
};

// What every status request reads.
export const STATUS_COLS = [
  PROPS.POWER,
  PROPS.MODE,
  PROPS.TARGET,
  PROPS.TEMP_UNIT,
  PROPS.TEMP_BIT,
  PROPS.INDOOR,
  PROPS.FAN,
  PROPS.TURBO,
  PROPS.QUIET,
  PROPS.SWING_VERTICAL,
  PROPS.SWING_HORIZONTAL,
  PROPS.LIGHT,
  PROPS.ECO,
  PROPS.FROST_GUARD,
  PROPS.XFAN,
  PROPS.SLEEP,
  PROPS.HEALTH,
];

// Gree operating modes (`Mod`).
export const GREE_MODES = { AUTO: 0, COOL: 1, DRY: 2, FAN: 3, HEAT: 4 };

// Setpoint range of the units in Celsius (remote and app: 16 to 30 °C).
export const TARGET_MIN = 16;
export const TARGET_MAX = 30;

// `TemSen` values at or above this carry the +40 offset.
export const INDOOR_OFFSET = 40;

// Quiet mode is 0 (off) or non-zero (on); the official app writes 2.
export const QUIET_ON = 2;

export class GreeError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {'timeout'|'bad-key'|'device-error'|'socket'} [details.kind]
   */
  constructor(message, { kind = 'device-error' } = {}) {
    super(message);
    this.name = 'GreeError';
    this.kind = kind;
  }

  /** The unit did not answer at all (or the integration is stopping). */
  get unreachable() {
    return this.kind === 'timeout' || this.kind === 'socket';
  }
}

const MAC = /^[0-9a-f]{12}$/;

/** "F4:91:1E:00:00:01" → "f4911e000001", or null. */
export function normalizeMac(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const mac = value.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  return MAC.test(mac) ? mac : null;
}

// --- Requests ------------------------------------------------------------------

export const SCAN_REQUEST = Buffer.from(JSON.stringify({ t: 'scan' }));

function envelope(mac, inner, key, cipher, { generic = false } = {}) {
  const { pack, tag } = encryptPack(inner, key, cipher);
  const message = { cid: 'app', i: generic ? 1 : 0, t: 'pack', uid: 0, tcid: mac, pack };
  if (tag) {
    message.tag = tag;
  }
  return Buffer.from(JSON.stringify(message));
}

/** Bind request: asks the unit for its own key, with the generic key. */
export function bindRequest(mac, cipher) {
  return envelope(mac, { mac, t: 'bind', uid: 0 }, GENERIC_KEYS[cipher], cipher, {
    generic: true,
  });
}

/** Status request for some properties, with the unit's key. */
export function statusRequest(unit, cols = STATUS_COLS) {
  return envelope(unit.mac, { cols, mac: unit.mac, t: 'status' }, unit.key, unit.cipher);
}

/** Command: set some properties, with the unit's key. */
export function commandRequest(unit, values) {
  const opt = Object.keys(values);
  return envelope(
    unit.mac,
    { opt, p: opt.map((name) => values[name]), t: 'cmd', mac: unit.mac },
    unit.key,
    unit.cipher,
  );
}

// --- Replies -------------------------------------------------------------------

/** The outer JSON envelope of a datagram, or null. */
export function parseEnvelope(buffer) {
  try {
    const decoded = JSON.parse(Buffer.from(buffer).toString('utf8'));
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * A scan reply: `{ mac, name, brand, model, version, cipher }`. The pack is
 * encrypted with a generic key, which tells the generation of the unit.
 * @throws {GreeCryptoError|GreeError} not a Gree scan reply
 */
export function parseScanReply(message) {
  if (!message || typeof message.pack !== 'string') {
    throw new GreeError('Not a Gree scan reply');
  }
  const { pack, cipher } = decryptGenericPack(message.pack, message.tag);
  if (pack.t !== 'dev') {
    throw new GreeError(`Unexpected reply "${pack.t}" to a scan`);
  }
  const mac = normalizeMac(pack.mac) ?? normalizeMac(pack.cid) ?? normalizeMac(message.cid);
  if (!mac) {
    throw new GreeError('Scan reply without a MAC address');
  }
  const text = (value) => (typeof value === 'string' ? value.trim().slice(0, 64) : '');
  return {
    mac,
    name: text(pack.name),
    brand: text(pack.brand) || text(pack.bc),
    model: text(pack.model),
    version: text(pack.ver),
    cipher,
  };
}

/**
 * Decrypt the pack of a reply to a bound exchange (bind uses the generic key).
 * @returns {object} the inner pack
 */
export function openReply(message, key, cipher) {
  if (!message || typeof message.pack !== 'string') {
    throw new GreeError('Reply without a pack');
  }
  return decryptPack(message.pack, key, cipher, message.tag);
}

/** `{ cols: [...], dat: [...] }` → `{ Pow: 1, ... }` */
export function zipValues(names, values) {
  const result = {};
  if (!Array.isArray(names) || !Array.isArray(values)) {
    return result;
  }
  names.forEach((name, index) => {
    if (typeof name === 'string' && index < values.length) {
      result[name] = values[index];
    }
  });
  return result;
}

// --- Values ----------------------------------------------------------------------

const intOrNull = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
};

/**
 * Normalize a status (`dat`) or command result (`res`) into integers. Values
 * a firmware does not have come back missing or as an empty string: dropped.
 */
export function normalizeProps(raw) {
  const props = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (name === PROPS.FIRMWARE) {
      if (typeof value === 'string' && value !== '') {
        props[name] = value.slice(0, 80);
      }
      continue;
    }
    const number = intOrNull(value);
    if (number !== null) {
      props[name] = number;
    }
  }
  return props;
}

/**
 * Indoor temperature in °C from `TemSen`, or null when the unit has no sensor
 * (0 or missing). Most firmware adds 40 (so 65 is 25 °C); some recent ones
 * send the temperature as is. A room is never below 0 °C nor above 40 °C, so
 * the value tells which.
 */
export function indoorTemperature(props) {
  const raw = props?.[PROPS.INDOOR];
  if (typeof raw !== 'number' || raw <= 0) {
    return null;
  }
  return raw >= INDOOR_OFFSET ? raw - INDOOR_OFFSET : raw;
}

/** Firmware version from `hid` ("362001000762+U-CS532AE(LT)V3.31.bin" → "3.31"). */
export function firmwareVersion(hid) {
  const match = typeof hid === 'string' ? hid.match(/V([\d.]+)\.bin$/) : null;
  return match ? match[1] : null;
}

export { CIPHERS };

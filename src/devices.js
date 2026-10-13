// -----------------------------------------------------------------------------
// From a Gree unit to a Gladys device, and back: discovery payload, state
// values, and the properties each command sets.
//
// One Gladys device per unit, keyed on its MAC address, in the
// `air-conditioning` category of Gladys (on/off, mode, setpoint, fan speed,
// swing), with the indoor temperature and the unit's extra functions (display
// light, eco, 8 °C frost guard, sleep, X-Fan, health) as their own features.
//
// Gladys and Gree number the modes differently; the fan speeds, the swing
// positions and the Gladys "quiet" and "turbo" speeds map one to one.
//
// Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import {
  GREE_MODES,
  PROPS,
  QUIET_ON,
  TARGET_MAX,
  TARGET_MIN,
  indoorTemperature,
} from './gree/protocol.js';

export const DEVICE_TYPE = 'gree';

export const FEATURE_KEYS = {
  POWER: 'power',
  MODE: 'mode',
  TARGET: 'target-temperature',
  INDOOR: 'indoor-temperature',
  FAN: 'fan-speed',
  SWING_VERTICAL: 'swing-vertical',
  SWING_HORIZONTAL: 'swing-horizontal',
  LIGHT: 'display-light',
  ECO: 'eco',
  FROST_GUARD: 'frost-guard',
  SLEEP: 'sleep',
  XFAN: 'x-fan',
  HEALTH: 'health',
};

// Gladys values (server/utils/constants.js of the core: AC_MODE,
// AC_FAN_SPEED, AC_SWING_*), mirrored here: the SDK does not export them.
export const AC_MODE = { AUTO: 0, COOLING: 1, HEATING: 2, DRYING: 3, FAN: 4 };
export const AC_FAN_SPEED = {
  AUTO: 0,
  LOW: 1,
  LOW_MID: 2,
  MID: 3,
  MID_HIGH: 4,
  HIGH: 5,
  QUIET: 6,
  TURBO: 7,
};
// Gree `SwUpDn` and `SwingLfRig`: 0 default, 1 full swing, 2-6 fixed
// positions, the same as Gladys' OFF, SWING, POSITION_1 to POSITION_5.
const SWING_MAX = 6;

const GLADYS_MODE_OF_GREE = {
  [GREE_MODES.AUTO]: AC_MODE.AUTO,
  [GREE_MODES.COOL]: AC_MODE.COOLING,
  [GREE_MODES.DRY]: AC_MODE.DRYING,
  [GREE_MODES.FAN]: AC_MODE.FAN,
  [GREE_MODES.HEAT]: AC_MODE.HEATING,
};
const GREE_MODE_OF_GLADYS = Object.fromEntries(
  Object.entries(GLADYS_MODE_OF_GREE).map(([gree, gladys]) => [gladys, Number(gree)]),
);

// Mode names, as words for the scene trigger variables and outputs.
export const MODE_WORDS = {
  [AC_MODE.AUTO]: 'auto',
  [AC_MODE.COOLING]: 'cool',
  [AC_MODE.HEATING]: 'heat',
  [AC_MODE.DRYING]: 'dry',
  [AC_MODE.FAN]: 'fan',
};

// Device, feature and option names: frozen when the user creates the device,
// written in the language chosen in the configuration at that moment. The
// option labels are those of the Gladys interface (front/src/config/i18n),
// which shows its own translation anyway.
export const NAMES = {
  en: {
    power: 'Air conditioner',
    mode: 'Mode',
    'target-temperature': 'Target temperature',
    'indoor-temperature': 'Indoor temperature',
    'fan-speed': 'Fan speed',
    'swing-vertical': 'Vertical swing',
    'swing-horizontal': 'Horizontal swing',
    'display-light': 'Display light',
    eco: 'Energy saving',
    'frost-guard': '8 °C frost guard',
    sleep: 'Sleep mode',
    'x-fan': 'X-Fan (coil drying)',
    health: 'Health (ionizer)',
    modeAuto: 'Auto',
    modeCool: 'Cooling',
    modeHeat: 'Heating',
    modeDry: 'Drying',
    modeFan: 'Fan',
    fanAuto: 'Auto',
    fanLow: 'Low',
    fanLowMid: 'Medium-low',
    fanMid: 'Medium',
    fanMidHigh: 'Medium-high',
    fanHigh: 'High',
    fanQuiet: 'Quiet',
    fanTurbo: 'Turbo',
    swingOff: 'Default',
    swingFull: 'Swing',
    swingPosition: 'Position',
  },
  fr: {
    power: 'Climatiseur',
    mode: 'Mode',
    'target-temperature': 'Température de consigne',
    'indoor-temperature': 'Température intérieure',
    'fan-speed': 'Vitesse de ventilation',
    'swing-vertical': 'Balayage vertical',
    'swing-horizontal': 'Balayage horizontal',
    'display-light': "Lumière de l'écran",
    eco: "Économie d'énergie",
    'frost-guard': 'Hors-gel 8 °C',
    sleep: 'Mode sommeil',
    'x-fan': 'X-Fan (séchage)',
    health: 'Health (ioniseur)',
    modeAuto: 'Auto',
    modeCool: 'Froid',
    modeHeat: 'Chaud',
    modeDry: 'Déshumidification',
    modeFan: 'Ventilation',
    fanAuto: 'Auto',
    fanLow: 'Basse',
    fanLowMid: 'Moyenne-basse',
    fanMid: 'Moyenne',
    fanMidHigh: 'Moyenne-haute',
    fanHigh: 'Haute',
    fanQuiet: 'Silencieux',
    fanTurbo: 'Turbo',
    swingOff: 'Par défaut',
    swingFull: 'Balayage',
    swingPosition: 'Position',
  },
  de: {
    power: 'Klimagerät',
    mode: 'Modus',
    'target-temperature': 'Solltemperatur',
    'indoor-temperature': 'Innentemperatur',
    'fan-speed': 'Lüftergeschwindigkeit',
    'swing-vertical': 'Vertikale Lamellen',
    'swing-horizontal': 'Horizontale Lamellen',
    'display-light': 'Displaybeleuchtung',
    eco: 'Energiesparen',
    'frost-guard': 'Frostschutz 8 °C',
    sleep: 'Schlafmodus',
    'x-fan': 'X-Fan (Trocknung)',
    health: 'Health (Ionisator)',
    modeAuto: 'Auto',
    modeCool: 'Kühlen',
    modeHeat: 'Heizen',
    modeDry: 'Entfeuchten',
    modeFan: 'Lüften',
    fanAuto: 'Auto',
    fanLow: 'Niedrig',
    fanLowMid: 'Mittel-niedrig',
    fanMid: 'Mittel',
    fanMidHigh: 'Mittel-hoch',
    fanHigh: 'Hoch',
    fanQuiet: 'Leise',
    fanTurbo: 'Turbo',
    swingOff: 'Standard',
    swingFull: 'Schwenken',
    swingPosition: 'Position',
  },
  es: {
    power: 'Aire acondicionado',
    mode: 'Modo',
    'target-temperature': 'Temperatura objetivo',
    'indoor-temperature': 'Temperatura interior',
    'fan-speed': 'Velocidad del ventilador',
    'swing-vertical': 'Oscilación vertical',
    'swing-horizontal': 'Oscilación horizontal',
    'display-light': 'Luz de la pantalla',
    eco: 'Ahorro de energía',
    'frost-guard': 'Antiheladas 8 °C',
    sleep: 'Modo noche',
    'x-fan': 'X-Fan (secado)',
    health: 'Health (ionizador)',
    modeAuto: 'Auto',
    modeCool: 'Frío',
    modeHeat: 'Calor',
    modeDry: 'Deshumidificación',
    modeFan: 'Ventilación',
    fanAuto: 'Auto',
    fanLow: 'Baja',
    fanLowMid: 'Media-baja',
    fanMid: 'Media',
    fanMidHigh: 'Media-alta',
    fanHigh: 'Alta',
    fanQuiet: 'Silencioso',
    fanTurbo: 'Turbo',
    swingOff: 'Predeterminado',
    swingFull: 'Oscilación',
    swingPosition: 'Posición',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.en;

/** External ids of the Gladys device of a unit. */
export const deviceIds = (gladys, mac) => gladys.externalIds(DEVICE_TYPE, mac);

/**
 * Default name: "Gree <name given in the Gree app>", or "Gree <end of the
 * MAC>" when the unit has none (or the app's default, its MAC digits).
 */
export function deviceName(record) {
  const given = typeof record.name === 'string' ? record.name.trim() : '';
  const isDefault = given === '' || /^[0-9a-f]{6,12}$/i.test(given);
  return `Gree ${isDefault ? record.mac.slice(-6).toUpperCase() : given.slice(0, 40)}`;
}

const options = (labels) =>
  labels.map(([value, label], index) => ({ value, label, sort_order: index }));

export function modeOptions(language) {
  const n = namesFor(language);
  return options([
    [AC_MODE.AUTO, n.modeAuto],
    [AC_MODE.COOLING, n.modeCool],
    [AC_MODE.HEATING, n.modeHeat],
    [AC_MODE.DRYING, n.modeDry],
    [AC_MODE.FAN, n.modeFan],
  ]);
}

export function fanOptions(language) {
  const n = namesFor(language);
  return options([
    [AC_FAN_SPEED.AUTO, n.fanAuto],
    [AC_FAN_SPEED.LOW, n.fanLow],
    [AC_FAN_SPEED.LOW_MID, n.fanLowMid],
    [AC_FAN_SPEED.MID, n.fanMid],
    [AC_FAN_SPEED.MID_HIGH, n.fanMidHigh],
    [AC_FAN_SPEED.HIGH, n.fanHigh],
    [AC_FAN_SPEED.QUIET, n.fanQuiet],
    [AC_FAN_SPEED.TURBO, n.fanTurbo],
  ]);
}

export function swingOptions(language) {
  const n = namesFor(language);
  const positions = [1, 2, 3, 4, 5].map((position) => [
    position + 1,
    `${n.swingPosition} ${position}`,
  ]);
  return options([[0, n.swingOff], [1, n.swingFull], ...positions]);
}

// The functions some units lack: published only when the unit reports the
// property (see capabilitiesOf).
const OPTIONAL_SWITCHES = [
  [FEATURE_KEYS.LIGHT, PROPS.LIGHT],
  [FEATURE_KEYS.ECO, PROPS.ECO],
  [FEATURE_KEYS.FROST_GUARD, PROPS.FROST_GUARD],
  [FEATURE_KEYS.SLEEP, PROPS.SLEEP],
  [FEATURE_KEYS.XFAN, PROPS.XFAN],
  [FEATURE_KEYS.HEALTH, PROPS.HEALTH],
];

/**
 * What a unit has, from a status reply: the optional properties it answered
 * and whether it has an indoor sensor. Capabilities only grow: a feature
 * once published is never withdrawn (that would orphan its history).
 * @param {object} props normalized status
 * @param {object} [previous] capabilities known so far
 */
export function capabilitiesOf(props, previous = {}) {
  const has = (name) => typeof props?.[name] === 'number';
  const caps = {
    indoor: previous.indoor === true || indoorTemperature(props) !== null,
    swingHorizontal: previous.swingHorizontal === true || has(PROPS.SWING_HORIZONTAL),
  };
  for (const [key, prop] of OPTIONAL_SWITCHES) {
    caps[key] = previous[key] === true || has(prop);
  }
  return caps;
}

export const sameCapabilities = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Feature specs of a unit, in publication order.
 * @param {object} caps capabilitiesOf() of the unit
 * @param {string} language
 */
export function featureSpecs(caps, language) {
  const names = namesFor(language);
  const AC = TYPES.AIR_CONDITIONING;
  const specs = [
    {
      key: FEATURE_KEYS.POWER,
      category: CATEGORIES.AIR_CONDITIONING,
      type: AC.BINARY,
      min: 0,
      max: 1,
      history: true,
    },
    {
      key: FEATURE_KEYS.MODE,
      category: CATEGORIES.AIR_CONDITIONING,
      type: AC.MODE,
      min: 0,
      max: 4,
      history: true,
      supported_options: modeOptions(language),
    },
    {
      key: FEATURE_KEYS.TARGET,
      category: CATEGORIES.AIR_CONDITIONING,
      type: AC.TARGET_TEMPERATURE,
      unit: UNITS.CELSIUS,
      min: TARGET_MIN,
      max: TARGET_MAX,
      history: true,
    },
  ];
  if (caps.indoor) {
    specs.push({
      key: FEATURE_KEYS.INDOOR,
      category: CATEGORIES.TEMPERATURE_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.CELSIUS,
      min: -10,
      max: 50,
      read_only: true,
      history: true,
    });
  }
  specs.push(
    {
      key: FEATURE_KEYS.FAN,
      category: CATEGORIES.AIR_CONDITIONING,
      type: AC.FAN_SPEED,
      min: 0,
      max: 7,
      history: false,
      supported_options: fanOptions(language),
    },
    {
      key: FEATURE_KEYS.SWING_VERTICAL,
      category: CATEGORIES.AIR_CONDITIONING,
      type: AC.SWING_VERTICAL,
      min: 0,
      max: SWING_MAX,
      history: false,
      supported_options: swingOptions(language),
    },
  );
  if (caps.swingHorizontal) {
    specs.push({
      key: FEATURE_KEYS.SWING_HORIZONTAL,
      category: CATEGORIES.AIR_CONDITIONING,
      type: AC.SWING_HORIZONTAL,
      min: 0,
      max: SWING_MAX,
      history: false,
      supported_options: swingOptions(language),
    });
  }
  for (const [key] of OPTIONAL_SWITCHES) {
    if (caps[key]) {
      specs.push({
        key,
        category: CATEGORIES.SWITCH,
        type: TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        history: false,
      });
    }
  }
  return specs.map((spec) => ({ ...spec, name: names[spec.key] }));
}

/** Discovery payload of one unit. */
export function buildDevice(gladys, record, language) {
  const ids = deviceIds(gladys, record.mac);
  return {
    name: deviceName(record),
    external_id: ids.device,
    model: 'Gree',
    // The container reads every unit itself (src/hub.js); the core's poll
    // is a fallback, once a minute, skipped while the timer runs.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [
      { name: 'IP_ADDRESS', value: record.host },
      { name: 'MAC_ADDRESS', value: record.mac },
      ...(record.firmware ? [{ name: 'FIRMWARE', value: record.firmware }] : []),
    ],
    features: featureSpecs(record.caps, language).map((spec) => {
      const feature = {
        name: spec.name,
        external_id: ids.feature(spec.key),
        category: spec.category,
        type: spec.type,
        min: spec.min,
        max: spec.max,
        read_only: spec.read_only === true,
        has_feedback: true,
        keep_history: spec.history,
      };
      if (spec.unit) {
        feature.unit = spec.unit;
      }
      if (spec.supported_options) {
        feature.supported_options = spec.supported_options;
      }
      return feature;
    }),
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const bit = (value) => (value ? 1 : 0);

/** Gladys mode of a Gree `Mod`, or null. */
export const gladysMode = (greeMode) => GLADYS_MODE_OF_GREE[greeMode] ?? null;

/** Gladys fan speed: turbo and quiet win over the speed they override. */
export function gladysFanSpeed(props) {
  if (props[PROPS.TURBO] > 0) {
    return AC_FAN_SPEED.TURBO;
  }
  if (props[PROPS.QUIET] > 0) {
    return AC_FAN_SPEED.QUIET;
  }
  const speed = props[PROPS.FAN];
  return isNumber(speed) && speed >= 0 && speed <= AC_FAN_SPEED.HIGH ? speed : null;
}

/** Gladys swing value: the partial swings of `SwUpDn` (7-11) are a swing. */
function gladysSwing(value) {
  if (!isNumber(value) || value < 0) {
    return null;
  }
  return value <= SWING_MAX ? value : 1;
}

/**
 * Feature values of a unit, by feature key: only what its last status told.
 * @param {object} record a hub record (`props`, `caps`)
 */
export function deviceValues(record) {
  const props = record.props ?? {};
  const { caps } = record;
  const values = {};
  if (isNumber(props[PROPS.POWER])) {
    values[FEATURE_KEYS.POWER] = bit(props[PROPS.POWER]);
  }
  const mode = gladysMode(props[PROPS.MODE]);
  if (mode !== null) {
    values[FEATURE_KEYS.MODE] = mode;
  }
  if (isNumber(props[PROPS.TARGET]) && props[PROPS.TARGET] > 0) {
    values[FEATURE_KEYS.TARGET] = props[PROPS.TARGET];
  }
  const indoor = indoorTemperature(props);
  if (caps.indoor && indoor !== null) {
    values[FEATURE_KEYS.INDOOR] = indoor;
  }
  const fan = gladysFanSpeed(props);
  if (fan !== null) {
    values[FEATURE_KEYS.FAN] = fan;
  }
  const vertical = gladysSwing(props[PROPS.SWING_VERTICAL]);
  if (vertical !== null) {
    values[FEATURE_KEYS.SWING_VERTICAL] = vertical;
  }
  const horizontal = gladysSwing(props[PROPS.SWING_HORIZONTAL]);
  if (caps.swingHorizontal && horizontal !== null) {
    values[FEATURE_KEYS.SWING_HORIZONTAL] = horizontal;
  }
  for (const [key, prop] of OPTIONAL_SWITCHES) {
    if (caps[key] && isNumber(props[prop])) {
      values[key] = bit(props[prop]);
    }
  }
  return values;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Properties setting the setpoint, keeping the unit's display unit. */
export function targetCommand(props, celsius) {
  return {
    [PROPS.TARGET]: clamp(Math.round(celsius), TARGET_MIN, TARGET_MAX),
    [PROPS.TEMP_UNIT]: props?.[PROPS.TEMP_UNIT] === 1 ? 1 : 0,
    [PROPS.TEMP_BIT]: 0,
  };
}

/** Properties setting a Gladys fan speed (quiet and turbo included). */
export function fanCommand(speed) {
  if (speed === AC_FAN_SPEED.TURBO) {
    return { [PROPS.TURBO]: 1, [PROPS.QUIET]: 0 };
  }
  if (speed === AC_FAN_SPEED.QUIET) {
    return { [PROPS.QUIET]: QUIET_ON, [PROPS.TURBO]: 0 };
  }
  if (Number.isInteger(speed) && speed >= AC_FAN_SPEED.AUTO && speed <= AC_FAN_SPEED.HIGH) {
    return { [PROPS.FAN]: speed, [PROPS.TURBO]: 0, [PROPS.QUIET]: 0 };
  }
  throw new Error(`Unknown fan speed ${speed}`);
}

/** Gree `Mod` of a Gladys mode. */
export function greeMode(mode) {
  const value = GREE_MODE_OF_GLADYS[mode];
  if (value === undefined) {
    throw new Error(`Unknown mode ${mode}`);
  }
  return value;
}

/**
 * The properties a Gladys command sets.
 * @param {object} record a hub record
 * @param {string} key feature key
 * @param {number|string} raw the value sent by Gladys
 */
export function commandFor(record, key, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid value "${raw}" for ${key}`);
  }
  const integer = Math.round(value);
  switch (key) {
    case FEATURE_KEYS.POWER:
      return { [PROPS.POWER]: bit(value) };
    case FEATURE_KEYS.MODE:
      return { [PROPS.MODE]: greeMode(integer) };
    case FEATURE_KEYS.TARGET:
      return targetCommand(record.props, value);
    case FEATURE_KEYS.FAN:
      return fanCommand(integer);
    case FEATURE_KEYS.SWING_VERTICAL:
      return { [PROPS.SWING_VERTICAL]: clamp(integer, 0, SWING_MAX) };
    case FEATURE_KEYS.SWING_HORIZONTAL:
      return { [PROPS.SWING_HORIZONTAL]: clamp(integer, 0, SWING_MAX) };
    case FEATURE_KEYS.SLEEP:
      // The sleep curve follows the switch (the official app sets both).
      return { [PROPS.SLEEP]: bit(value), [PROPS.SLEEP_MODE]: bit(value) };
    default: {
      const entry = OPTIONAL_SWITCHES.find(([feature]) => feature === key);
      if (!entry) {
        throw new Error(`The feature ${key} cannot be controlled`);
      }
      return { [entry[1]]: bit(value) };
    }
  }
}

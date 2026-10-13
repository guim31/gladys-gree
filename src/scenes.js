// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// Power, mode, setpoint and fan speed are already Gladys scene actions on the
// device features, one command each: the unit beeps and changes in steps.
// `apply_settings` sets them in one command, the way the remote does.
// `turn_off_all` reaches every unit added to Gladys, including the ones added
// after the scene was written.
//
// The trigger (`changed_outside_gladys`) is fired by the hub (src/hub.js),
// never as a consequence of these actions: a scene bound to it would loop.
// -----------------------------------------------------------------------------

import { AC_FAN_SPEED, AC_MODE } from './devices.js';
import { indoorTemperature } from './gree/protocol.js';

// Option values of the manifest fields (permanent: stored in the scenes).
export const MODE_OPTIONS = {
  auto: AC_MODE.AUTO,
  cool: AC_MODE.COOLING,
  heat: AC_MODE.HEATING,
  dry: AC_MODE.DRYING,
  fan: AC_MODE.FAN,
};
export const FAN_OPTIONS = {
  auto: AC_FAN_SPEED.AUTO,
  low: AC_FAN_SPEED.LOW,
  medium_low: AC_FAN_SPEED.LOW_MID,
  medium: AC_FAN_SPEED.MID,
  medium_high: AC_FAN_SPEED.MID_HIGH,
  high: AC_FAN_SPEED.HIGH,
  quiet: AC_FAN_SPEED.QUIET,
  turbo: AC_FAN_SPEED.TURBO,
};

function option(table, value, name) {
  if (!Object.hasOwn(table, value)) {
    throw new Error(`Unknown ${name} "${value}"`);
  }
  return table[value];
}

export const SCENE_ACTIONS = {
  async apply_settings(hub, { fields }) {
    const given = (value) => value !== undefined && value !== null && value !== '';
    const record = await hub.applySettings(fields.device, {
      mode: option(MODE_OPTIONS, fields.mode, 'mode'),
      target: fields.target_temperature,
      fan: given(fields.fan_speed) ? option(FAN_OPTIONS, fields.fan_speed, 'fan speed') : null,
    });
    const indoor = record.caps.indoor ? indoorTemperature(record.props) : null;
    return indoor === null ? {} : { indoor_temperature: indoor };
  },

  async turn_off_all(hub) {
    return { count: await hub.turnOffAll() };
  },
};

# Gree

Control your **Gree** air conditioners from Gladys, over your local network:
on and off, mode, setpoint, fan speed, swing, and the unit's extra functions.
The integration also works with the rebrands of Gree units that are set up in
the **Gree+** app, for example Cooper & Hunter, Trane, Innova, Proklima,
Tadiran, Heiwa, Ekokai or Lessar. It comes with a dashboard widget, a scene
trigger and two scene actions. No account and no cloud: Gladys talks to each
unit directly, like the Gree+ app does on your Wi-Fi.

> **Developed without the hardware: feedback welcome.** This integration was
> built from the published descriptions of the Gree protocol and tested
> against simulated units, not against a real air conditioner. If something
> does not work as described, please say so on the
> [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-gree/issues). This integration is
> not affiliated with Gree.

## What you need

- Gladys Assistant 5.1.0 or later.
- Air conditioners with a Gree Wi-Fi module, already connected to your Wi-Fi
  with the **Gree+** app (Gladys cannot do this first setup), on the same
  network as Gladys.
- Nothing else: no Gree account, no key, no internet access. The integration
  pairs with each unit by itself, locally, and keeps the key each unit gives.

## Set up

1. Install the integration from the Gladys catalog.
2. Open its **Configuration**. Nothing is required; the options are:
   - **IP addresses of the air conditioners**: only for the units automatic
     discovery does not find, separated by commas (for example
     `192.168.1.60, 192.168.1.61`). Your router lists the address of each
     unit. Giving each unit a fixed address in your router is a good idea.
   - **Refresh interval**: how often each unit is read, 10, 15, 30 or 60
     seconds (30 by default). It is how fast Gladys sees a change made with
     the remote control or the Gree+ app.
   - **Beep on commands from Gladys**: the units beep when they receive a
     command, as with the remote. "Silent" asks them not to, which is nice in
     a bedroom; some firmware ignores it.
   - **Language of the device names**: English, French, German or Spanish
     (French by default). The names of a device's features are given when the
     device is added.
3. Open the **Discovery** tab: every unit found appears, named "Gree" and the
   name given in the Gree+ app (or the end of its MAC address). Add the ones
   you want. The **Search for air conditioners** button of the Configuration
   screen searches again and tells what was found.

Discovery goes through Gladys itself (the integration runs in an isolated
container that cannot reach your network in broadcast): Gladys sends the
search on UDP port 7000, the port of the Gree protocol, and passes the answers
on. The integration then talks to each unit directly. A new search runs every
15 minutes, to find new units and follow a unit whose address changed.

## The Gladys devices

One device per air conditioner, with these features:

| Feature             | What it does                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Air conditioner     | On and off.                                                                                           |
| Mode                | Auto, cooling, heating, drying, fan.                                                                  |
| Target temperature  | 16 to 30 °C, in whole degrees.                                                                        |
| Indoor temperature  | The temperature the unit measures, when it has a sensor (read only).                                  |
| Fan speed           | Auto, low, medium-low, medium, medium-high, high, plus "Quiet" and "Turbo", which override the speed. |
| Vertical swing      | Default, swing, or one of five fixed positions.                                                       |
| Horizontal swing    | Same, on the units with motorised side vanes.                                                         |
| Display light       | The display and lights of the indoor unit.                                                            |
| Energy saving       | The unit's energy saving mode.                                                                        |
| 8 °C frost guard    | Keeps the room at 8 °C, in heating mode (the "8 °C heat" of the remote).                              |
| Sleep mode          | The night curve of the unit: the setpoint drifts slowly during the night.                             |
| X-Fan (coil drying) | Keeps the fan running for a while after switching off, to dry the coil (cooling and drying modes).    |
| Health (ionizer)    | The ionizer ("Health" or "cold plasma"), on the units that have one.                                  |

A feature appears only when the unit reports the matching function: a unit
without sensor has no indoor temperature, a unit without motorised side vanes
no horizontal swing. If a function shows up later (a sensor that answered
late), the Discovery tab offers to update the device. A function the unit
reports but does not really have (it happens) simply has no effect.

Changes made with the remote control or the Gree+ app reach Gladys within the
refresh interval. A unit that stops answering (power cut, Wi-Fi lost) keeps
its last values in Gladys, with an "unreachable" badge, until it answers
again.

## Dashboard widget

The **Air conditioners** widget shows every Gree unit added to Gladys on one
card: for each one, its mode, setpoint and room temperature, or "Off", or
"Not answering". Its **Turn all off** button turns off every unit that is on,
in one tap: leaving home, going to bed. The widget has no settings.

## Scenes

### Trigger

**Air conditioner changed outside Gladys**: someone turned a unit on or off,
or changed its mode or setpoint, with the remote control or the Gree+ app.
What Gladys does itself never fires it, so a scene can react to the remote
without reacting to its own commands. Filters (all optional): the air
conditioner, and the change: **Turned on**, **Turned off**,
**Mode or setpoint changed**. Variables available to the actions: the change
(`turned_on`, `turned_off`, `settings`), the power (`on`, `off`), the mode
(`auto`, `cool`, `heat`, `dry`, `fan`), the setpoint and the indoor
temperature in °C.

### Actions

- **Turn on with settings**: turns an air conditioner on with a mode, and
  optionally a setpoint (16 to 30 °C) and a fan speed, in a single command,
  so a single beep. It returns the indoor temperature, for a notification.
  The usual Gladys actions on the device features work too, one command each.
- **Turn off every air conditioner**: turns off every Gree unit added to
  Gladys that is on and answering, including the ones added after the scene
  was written. It returns how many were turned off.

### Scene ideas

- **Leaving home**: when the last person leaves, "Turn off every air
  conditioner", then send a message with the number of units turned off.
- **Cool the bedroom before bedtime**: at 22:00 in summer, if the bedroom is
  above 26 °C, "Turn on with settings" on the bedroom unit: cooling, 25 °C,
  quiet fan.
- **Someone took the remote**: on "Air conditioner changed outside Gladys",
  change "Turned on", while a window sensor says the window is open: send a
  message "The air conditioner is on with the window open".

## Troubleshooting

- **No unit found**: check that the unit is connected with the Gree+ app and
  on the same network as Gladys (not on a guest Wi-Fi), then press **Search
  for air conditioners**. If it is still missing, enter its IP address in the
  configuration. The report under the button says when the automatic
  discovery is unavailable.
- **"refuses the pairing"**: the unit answers but refuses to give its key.
  Restart it (switch it off at the breaker for a minute), then search again.
- **Not answering**: the unit is off at the breaker, out of Wi-Fi range, or
  has a new address. A search finds it again at its new address; a fixed
  address in your router avoids the problem.
- **Paired again with the Gree+ app**: a unit reset or added again in the app
  gets a new key. The integration notices and pairs again by itself.
- **The unit beeps at every command**: choose "Silent" for **Beep on commands
  from Gladys**. Some firmware ignores it.
- **The logs**: the integration only writes its life (start, units found,
  lost and back, errors) and one line per command. More detail with
  `LOG_LEVEL=debug`. The keys of the units never appear in the logs.

## Limits

- Developed without the hardware: the protocol is the one the Gree+ app uses
  on the local network, as described by open source projects, but this
  integration has not been tried on a real unit yet.
- The first Wi-Fi setup of a unit needs the Gree+ app.
- Units behind a multi-split or VRF gateway (one Wi-Fi module for several
  indoor units) are not supported, nor the Gree dehumidifiers.
- Whole degrees only, in Celsius; a unit displaying Fahrenheit keeps its
  display unit.
- The indoor temperature is the unit's own sensor: near the ceiling, often a
  little warmer than the room.
- The units do not tell Gladys about their changes: Gladys reads them at the
  refresh interval, so a change made with the remote shows up within that
  delay.
- Requests: one short UDP exchange per unit at each refresh, nothing on the
  internet; there is no quota.
- The keys of the units are kept in the integration's data volume
  (`/data/gree-state.json`), readable only by the integration.

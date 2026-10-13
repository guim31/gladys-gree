# Gree for Gladys Assistant

Control **Gree** air conditioners, and the Gree units sold under other brands,
from [Gladys Assistant](https://gladysassistant.com), over the local network:
no account, no cloud. The integration speaks the local Wi-Fi protocol of the
Gree+ app (JSON over UDP port 7000, encrypted with AES).

> **Developed without the hardware: feedback welcome.** The integration was
> written from the published descriptions of the protocol and tested against
> simulated units, not against a real air conditioner. Please report what
> works and what does not in the
> [issues](https://github.com/guim31/gladys-gree/issues).

## Features

- **Automatic discovery** of the units on the network, through the Gladys core
  (mediated UDP broadcast), or by IP address.
- **Local pairing**: the integration asks each unit for its key, as the app
  does, and keeps it in `/data`. Both generations of encryption are handled
  (AES-ECB, and AES-GCM of recent firmware); a unit paired again in the app is
  paired again by itself.
- **One Gladys device per unit**, in the air-conditioning category: on/off,
  mode (auto, cooling, heating, drying, fan), setpoint (16-30 °C), fan speed
  (auto, five speeds, quiet, turbo), vertical and horizontal swing (swing or
  five fixed positions), indoor temperature when the unit has a sensor, and
  the extra functions as switches: display light, energy saving, 8 °C frost
  guard, sleep mode, X-Fan, health (ionizer). A feature is published only
  when the unit reports the function.
- Changes made with the remote control or the app reach Gladys within the
  refresh interval (30 s by default, 10 to 60). A unit that stops answering is
  shown unreachable.
- A **dashboard widget** with every unit at a glance and a "Turn all off"
  button.
- A **scene trigger** for changes made outside Gladys (remote, app), and two
  **scene actions**: turn on with mode, setpoint and fan speed in a single
  command, and turn off every unit.
- Texts in English, French, German and Spanish.

Units known to use the protocol, per the Home Assistant documentation: Gree,
Cooper & Hunter, Trane, Innova, Proklima, Tadiran, Heiwa, Ekokai, Lessar — in
short, units set up with the Gree+ app.

## Requirements

- Gladys Assistant **5.1.0** or later.
- Units connected to the Wi-Fi with the Gree+ app (the first setup cannot be
  done from Gladys), on the network of Gladys.

## Installation

In Gladys, open **Integrations**, then **Install from GitHub**, and enter the
address of this repository:

```
https://github.com/guim31/gladys-gree
```

Then open the **Discovery** tab of the integration and add the units. The
[documentation](docs/en.md) details the options, the widget and the scenes
([français](docs/fr.md), [Deutsch](docs/de.md), [español](docs/es.md)).

## How it works

- **Protocol**: JSON datagrams on UDP port 7000. A `scan` in clear gets a
  `dev` reply (MAC, name, firmware) encrypted with a generic key; a `bind`
  with the generic key gets the unit's own key; `status` reads properties by
  name (`Pow`, `Mod`, `SetTem`, `TemSen`, `WdSpd`…), `cmd` sets them. The
  generic key that opens the scan reply tells the generation: AES-128-ECB, or
  AES-128-GCM with a fixed nonce on recent firmware.
- **Discovery**: the container sits on a Docker bridge, where a broadcast it
  sent would never reach the LAN. The Gladys core sends the scan
  (`udp-active-broadcast` mediated discovery, port 7000 declared in the
  manifest) and relays the replies; the units are then reached in unicast.
  A new scan runs every 15 minutes, and soon after a unit stops answering.
- **Polling**: the units never push their changes. The integration reads the
  units added to Gladys by its own timer; the devices are published with
  `should_poll` and a one-minute `poll_frequency` as a fallback, skipped while
  the timer runs (the core does not poll reliably, GladysAssistant/Gladys#3198).
  Only changes are published, and every value again every 6 hours.
- **Identity**: each unit is identified by its MAC address, so a new IP
  address (DHCP) keeps the Gladys device. The units, their address, generation
  and key are kept in `/data/gree-state.json` (mode 600), so a restart talks to
  them without pairing again.

## Checked, and what was not

Checked:

- the encryption, byte for byte, against an independent implementation
  (Python `cryptography`): ECB and GCM, both ways;
- the whole integration against the fake Gladys of the SDK and simulated
  units of both generations (with and without indoor sensor, with the +40
  offset of the sensor or without, Fahrenheit display, missing optional
  functions, lost datagrams, a unit reset and paired again, a new address, a
  unit refusing the pairing);
- every device against the rules of the Gladys core (feature couples, bounds,
  units, options, poll frequencies) in the four languages.

Not checked, for want of hardware or of a Gladys instance:

- a real unit: the replies of each firmware, the buzzer properties, the value
  of the quiet mode (2, as the official app writes it), the properties a unit
  reports without having the function;
- the discovery through a real Gladys core on a real LAN;
- the rendering of the widget and of the scene cards in the Gladys interface.

`scripts/probe.mjs` tries the protocol code against real units from a machine
of the network (scan, pairing, status, never a command), and prints an
anonymized report.

## Limitations

- Changes made outside Gladys are seen at the next reading (10 to 60 s).
- Whole degrees in Celsius; a unit displaying Fahrenheit keeps its display.
- Multi-split and VRF gateways, Gree dehumidifiers: not supported.
- The first Wi-Fi setup of a unit needs the Gree+ app.
- The manual addresses must be IPv4 addresses.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

## Credits

- [tomikaa87/gree-remote](https://github.com/tomikaa87/gree-remote) (GPL-3.0)
  and [cmroche/greeclimate](https://github.com/cmroche/greeclimate)
  (GPL-3.0): their descriptions of the protocol, read to understand it. No
  code was copied from them; the implementation here is original.
- The [Home Assistant Gree integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/gree)
  (Apache License 2.0): the functions exposed and the list of brands.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## Disclaimer

This project is not affiliated with, endorsed by or connected to Gree Electric
Appliances or any of the brands named here. Gree is a trademark of its owner.

## License

[Apache License 2.0](LICENSE).

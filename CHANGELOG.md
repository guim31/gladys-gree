# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Gree air conditioners, and the Gree units sold under other brands (set up
  with the Gree+ app), on the local network: no account, no cloud.
- Automatic discovery through Gladys, or by IP address; local pairing with
  each unit, both generations of encryption (AES-ECB and AES-GCM). A unit
  paired again in the Gree+ app is paired again by itself.
- One device per unit: on/off, mode, setpoint (16-30 °C), fan speed (with
  quiet and turbo), vertical and horizontal swing, indoor temperature, and
  the display light, energy saving, 8 °C frost guard, sleep mode, X-Fan and
  health functions when the unit has them.
- Changes made with the remote control or the app reach Gladys within the
  refresh interval (30 seconds by default, 10 to 60). A unit that stops
  answering is shown unreachable.
- An "Air conditioners" dashboard widget: every unit at a glance and a
  "Turn all off" button.
- A scene trigger, "Air conditioner changed outside Gladys", and two scene
  actions: "Turn on with settings" (mode, setpoint and fan speed in one
  command) and "Turn off every air conditioner".
- An option to ask the units not to beep at Gladys' commands.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-gree/commits/main

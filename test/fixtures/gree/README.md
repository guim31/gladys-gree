# Gree fixtures

Built for the tests from the published descriptions of the protocol
(`tomikaa87/gree-remote`, the behaviour of `greeclimate`), not captured on a
unit: the integration was developed without the hardware. Every MAC address is
locally administered (`02:ab:...`) and invented; no key, name or address comes
from a real installation.

- `<unit>.json`: one simulated unit (`test/helpers/fakeGree.js`): its
  generation of encryption (`cipher`), its scan reply (`dev`), its firmware
  (`hid`) and the properties its status answers (a property absent from
  `status` is one the firmware does not report).
- `crypto-vectors.json`: known-answer vectors made with the Python
  `cryptography` package, an implementation independent of `node:crypto`.

# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration stores and sends:

- `/data/gree-state.json` (mode 600): for each air conditioner, its MAC and IP
  addresses, the name given in the Gree+ app, its generation of encryption
  and the key it gave at pairing. The key only opens the local protocol of
  that unit; it is never written in the logs.
- The configuration holds no secret: IP addresses, refresh interval, beep
  option, language.
- Network: UDP port 7000 on the local network only, to the units (unicast)
  and, through the Gladys core, the discovery broadcast. Nothing goes to the
  internet. The protocol of the units is the vendor's: anyone on the local
  network can pair with a unit the same way, which is outside the control of
  this integration.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the air conditioners, their firmware and the Gree+ app.

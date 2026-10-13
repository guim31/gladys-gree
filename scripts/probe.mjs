#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of real Gree units, with the integration's own protocol
// code, from a machine on the same network (not from the Gladys container).
//
//   node scripts/probe.mjs              broadcast scan on the local network
//   node scripts/probe.mjs 192.0.2.60   one unit, by its address
//
// For each unit it scans, pairs (asks for the unit's key: this changes
// nothing on the unit, the Gree+ app keeps working) and reads the status.
// It never sends a command. What it prints can be pasted in an issue: the
// MAC address is cut to its last two bytes, the IP address to its last
// number, and the key is never printed.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import {
  GREE_PORT,
  PROPS,
  SCAN_REQUEST,
  STATUS_COLS,
  firmwareVersion,
  indoorTemperature,
  parseEnvelope,
  parseScanReply,
} from '../src/gree/protocol.js';
import { GreeTransport } from '../src/gree/transport.js';

const SCAN_SECONDS = 4;

const maskMac = (mac) => `xx:xx:xx:xx:${mac.slice(8, 10)}:${mac.slice(10, 12)}`;
const maskIp = (ip) => `x.x.x.${ip.split('.').pop()}`;

/** Broadcast a scan and collect the replies: `[{ host, info }]`. */
function broadcastScan() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const found = new Map();
    socket.on('error', reject);
    socket.on('message', (message, remote) => {
      try {
        const info = parseScanReply(parseEnvelope(message));
        found.set(info.mac, { host: remote.address, info });
      } catch {
        // Not a Gree unit.
      }
    });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      socket.send(SCAN_REQUEST, GREE_PORT, '255.255.255.255');
      setTimeout(() => {
        socket.close();
        resolve([...found.values()]);
      }, SCAN_SECONDS * 1000);
    });
  });
}

async function probe(transport, host, info) {
  const unit = info ?? (await transport.scan(host));
  console.log(`\nUnit ${maskMac(unit.mac)} at ${maskIp(host)}`);
  console.log(
    `  scan: cipher ${unit.cipher}, module version ${unit.version || '?'}, name ${unit.name ? 'set' : 'empty'}, brand "${unit.brand}", model "${unit.model}"`,
  );
  const key = await transport.bind(host, unit);
  console.log('  bind: ok (key not shown)');
  const props = await transport.status(host, { mac: unit.mac, key, cipher: unit.cipher }, [
    ...STATUS_COLS,
    PROPS.FIRMWARE,
  ]);
  const firmware = props[PROPS.FIRMWARE];
  delete props[PROPS.FIRMWARE];
  console.log(`  firmware: ${firmwareVersion(firmware) ?? '?'}`);
  console.log(`  status: ${JSON.stringify(props)}`);
  console.log(`  missing: ${STATUS_COLS.filter((name) => !(name in props)).join(', ') || 'none'}`);
  console.log(
    `  indoor temperature: ${indoorTemperature(props) ?? 'no sensor'} (raw TemSen ${props.TemSen})`,
  );
}

const transport = new GreeTransport();
try {
  const host = process.argv[2];
  const targets = host ? [{ host, info: null }] : await broadcastScan();
  if (targets.length === 0) {
    console.log('No Gree unit answered the scan.');
  }
  for (const target of targets) {
    try {
      await probe(transport, target.host, target.info);
    } catch (err) {
      console.log(`  failed: ${err.message.replaceAll(target.host, maskIp(target.host))}`);
    }
  }
} finally {
  transport.close();
}

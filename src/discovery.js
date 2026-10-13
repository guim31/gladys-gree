// -----------------------------------------------------------------------------
// Where to look for Gree units: the replies to a scan broadcast the Gladys core
// emits for the integration, the addresses typed in the configuration, and
// the addresses already known.
//
// The integration container sits on a bridge network: a broadcast it sent
// would never reach the LAN, and the units answer in unicast to whoever
// broadcast. So the core broadcasts (mediated `udp-active-broadcast`
// discovery, port 7000 declared in the manifest `network_discovery`): the
// integration forges the request, the core relays the raw replies. The MAC
// address in each reply identifies the unit whatever address it answers on.
// -----------------------------------------------------------------------------

import { GREE_PORT, SCAN_REQUEST, parseEnvelope, parseScanReply } from './gree/protocol.js';

export const SCAN_TIMEOUT_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The broadcast request of a discovery scan (`scanNetwork` options). */
export function scanRequest() {
  return { port: GREE_PORT, payload: SCAN_REQUEST, timeoutSeconds: SCAN_TIMEOUT_SECONDS };
}

/**
 * Units that answered a discovery scan: `[{ host, ...parseScanReply() }]`,
 * one per MAC. A reply that is not a Gree one is ignored.
 * @param {Array} replies raw results `[{ source_ip, source_port, payload_base64 }]`
 */
export function parseScanReplies(replies) {
  const found = new Map();
  for (const reply of Array.isArray(replies) ? replies : []) {
    if (!reply || typeof reply.source_ip !== 'string' || !IPV4.test(reply.source_ip)) {
      continue;
    }
    const message = parseEnvelope(Buffer.from(String(reply.payload_base64 ?? ''), 'base64'));
    let info;
    try {
      info = parseScanReply(message);
    } catch {
      continue;
    }
    if (!found.has(info.mac)) {
      found.set(info.mac, { host: reply.source_ip, ...info });
    }
  }
  return [...found.values()];
}

/**
 * Run `task` on every item, `limit` at a time; resolves with the results in
 * order (`{ value }` or `{ error }`).
 */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

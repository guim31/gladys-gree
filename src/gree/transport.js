// -----------------------------------------------------------------------------
// The UDP client of the Gree protocol: one socket for every unit, bound on an
// ephemeral port; replies come back in unicast to that port (they cross the
// NAT of the Docker bridge, as unicast does both ways).
//
// One exchange at a time per unit: a reply is matched on the address it comes
// from and on its type (`dev`, `bindok`, `dat`, `res`), so two exchanges with
// the same unit never cross. UDP loses datagrams and the units are slow to
// wake their Wi-Fi module: a request is sent again with a growing delay until
// the reply or the deadline (every request is idempotent: a status read, or
// absolute values to set).
//
// A datagram from the unit that cannot be decrypted with the expected key
// means the unit has another key (it was reset and paired again): the
// exchange then fails as `bad-key` rather than as a timeout, so the hub binds
// again.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { GENERIC_KEYS } from './crypto.js';
import {
  GREE_PORT,
  GreeError,
  SCAN_REQUEST,
  bindRequest,
  commandRequest,
  normalizeProps,
  openReply,
  parseEnvelope,
  parseScanReply,
  statusRequest,
  zipValues,
} from './protocol.js';

export const TRANSPORT_TIMINGS = {
  // Total wait for a reply (status reads, scan and bind).
  timeoutMs: 5_000,
  // Commands: the user waits, but a lost datagram should not fail them.
  commandTimeoutMs: 7_000,
  firstRetryMs: 1_000,
  maxRetryMs: 2_000,
};

export class GreeTransport {
  /**
   * @param {object} [options]
   * @param {() => object} [options.createSocket] test seam: a dgram-like socket
   * @param {number} [options.port] destination port of the units
   * @param {object} [options.timings] TRANSPORT_TIMINGS overrides
   * @param {object} [options.logger]
   */
  constructor({ createSocket, port = GREE_PORT, timings, logger } = {}) {
    this.createSocket = createSocket ?? (() => dgram.createSocket('udp4'));
    this.port = port;
    this.timings = { ...TRANSPORT_TIMINGS, ...timings };
    this.logger = logger;
    this.socket = null;
    this.opening = null;
    /** @type {Map<string, { accept: Function }>} the exchange waiting, by address */
    this.pending = new Map();
    /** @type {Map<string, Promise>} tail of the exchanges of each unit */
    this.queues = new Map();
    this.closed = false;
  }

  /** Bind the socket (once). */
  open() {
    if (this.socket) {
      return Promise.resolve();
    }
    this.opening ??= new Promise((resolve, reject) => {
      const socket = this.createSocket();
      const onError = (err) => {
        this.opening = null;
        reject(new GreeError(`Cannot open the UDP socket: ${err.message}`, { kind: 'socket' }));
      };
      socket.once('error', onError);
      socket.on('message', (message, remote) => this.receive(message, remote));
      socket.bind(0, () => {
        socket.off('error', onError);
        if (this.closed) {
          // Closed while binding: never keep the socket.
          socket.close();
          resolve();
          return;
        }
        socket.on('error', (err) => this.logger?.warn(`UDP socket error: ${err.message}`));
        // Never keep the process alive for the socket alone.
        socket.unref?.();
        this.socket = socket;
        resolve();
      });
    });
    return this.opening;
  }

  close() {
    this.closed = true;
    for (const { accept } of this.pending.values()) {
      accept({ closed: true });
    }
    this.pending.clear();
    try {
      this.socket?.close();
    } catch {
      // Already closed.
    }
    this.socket = null;
    this.opening = null;
  }

  receive(message, remote) {
    const waiting = this.pending.get(remote?.address);
    if (!waiting) {
      return;
    }
    const decoded = parseEnvelope(message);
    if (!decoded) {
      this.logger?.debug(`Ignored a datagram that is not JSON from ${remote.address}`);
      return;
    }
    waiting.accept({ message: decoded });
  }

  /** Run `exchange` after the previous one with the same unit. */
  queue(host, exchange) {
    const previous = this.queues.get(host) ?? Promise.resolve();
    const run = previous.then(exchange);
    const tail = run.catch(() => {});
    this.queues.set(host, tail);
    tail.then(() => {
      if (this.queues.get(host) === tail) {
        this.queues.delete(host);
      }
    });
    return run;
  }

  /**
   * Send `data` to a unit until `decode` accepts a reply, or the deadline.
   * `decode(envelope)` returns the result, `undefined` for a datagram that is
   * not the reply (a late answer to a previous request), or throws when the
   * datagram cannot be decrypted.
   */
  async exchange(host, data, decode, { timeoutMs = this.timings.timeoutMs, what }) {
    if (this.closed) {
      throw new GreeError('The integration is stopping', { kind: 'socket' });
    }
    await this.open();
    if (this.closed) {
      throw new GreeError('The integration is stopping', { kind: 'socket' });
    }
    let retryTimer = null;
    let deadline = null;
    let entry = null;
    let undecryptable = 0;
    const outcome = await new Promise((resolve) => {
      entry = {
        accept: (received) => {
          if (received.closed) {
            resolve(received);
            return;
          }
          try {
            const result = decode(received.message);
            if (result !== undefined) {
              resolve({ result });
            }
          } catch (err) {
            undecryptable += 1;
            this.logger?.debug(`Undecryptable ${what} reply from ${host}: ${err.message}`);
          }
        },
      };
      this.pending.set(host, entry);
      let delay = this.timings.firstRetryMs;
      const send = () => {
        this.socket?.send(data, this.port, host, (err) => {
          if (err) {
            this.logger?.debug(`Cannot send ${what} to ${host}: ${err.message}`);
          }
        });
        retryTimer = setTimeout(send, delay);
        delay = Math.min(delay * 2, this.timings.maxRetryMs);
      };
      deadline = setTimeout(() => resolve({ timeout: true }), timeoutMs);
      send();
    });
    clearTimeout(retryTimer);
    clearTimeout(deadline);
    if (this.pending.get(host) === entry) {
      this.pending.delete(host);
    }
    if (outcome.closed) {
      throw new GreeError('The integration is stopping', { kind: 'socket' });
    }
    if (outcome.timeout) {
      if (undecryptable > 0) {
        throw new GreeError(`${host} answered ${what} with another key`, { kind: 'bad-key' });
      }
      throw new GreeError(`${host} did not answer ${what}`, { kind: 'timeout' });
    }
    return outcome.result;
  }

  /**
   * Ask one address whether a Gree unit is there (unicast scan).
   * @returns {Promise<object>} parseScanReply() of its answer
   */
  scan(host) {
    return this.queue(host, () =>
      this.exchange(host, SCAN_REQUEST, (message) => parseScanReply(message), { what: 'scan' }),
    );
  }

  /**
   * Ask a unit for its own key.
   * @param {string} host
   * @param {{ mac: string, cipher: 'ecb'|'gcm' }} unit
   * @returns {Promise<string>} the key
   */
  bind(host, unit) {
    return this.queue(host, () =>
      this.exchange(
        host,
        bindRequest(unit.mac, unit.cipher),
        (message) => {
          const pack = openReply(message, GENERIC_KEYS[unit.cipher], unit.cipher);
          if (pack.t !== 'bindok') {
            return undefined;
          }
          if (typeof pack.key !== 'string' || Buffer.byteLength(pack.key) !== 16) {
            throw new GreeError(`${host} answered the bind without a valid key`);
          }
          return pack.key;
        },
        { what: 'bind' },
      ),
    );
  }

  /**
   * Read properties of a bound unit.
   * @param {string} host
   * @param {{ mac: string, key: string, cipher: string }} unit
   * @param {string[]} [cols]
   * @returns {Promise<object>} property name → integer (or `hid` string)
   */
  status(host, unit, cols) {
    return this.queue(host, () =>
      this.exchange(
        host,
        statusRequest(unit, cols),
        (message) => {
          const pack = openReply(message, unit.key, unit.cipher);
          return pack.t === 'dat' ? normalizeProps(zipValues(pack.cols, pack.dat)) : undefined;
        },
        { what: 'status' },
      ),
    );
  }

  /**
   * Set properties of a bound unit.
   * @returns {Promise<object>} the values the unit applied
   */
  command(host, unit, values) {
    return this.queue(host, () =>
      this.exchange(
        host,
        commandRequest(unit, values),
        (message) => {
          const pack = openReply(message, unit.key, unit.cipher);
          if (pack.t !== 'res') {
            return undefined;
          }
          const applied = Array.isArray(pack.val) && pack.val.length > 0 ? pack.val : pack.p;
          return normalizeProps(zipValues(pack.opt, applied));
        },
        { what: 'command', timeoutMs: this.timings.commandTimeoutMs },
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// Fake Gree units on a fake UDP network: `createNetwork(units).createSocket`
// replaces `dgram.createSocket` in the transport. Each unit speaks the
// protocol of its fixture (test/fixtures/gree): it answers the scan in clear,
// binds with the generic key of its generation (ECB or GCM) and gives its own
// key, reads and sets its properties with that key only. It can be taken
// offline, made to lose datagrams, or reset (a new key, as after pairing it
// again in the Gree+ app).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { GENERIC_KEYS, decryptPack, encryptPack } from '../../src/gree/crypto.js';

const FIXTURES = new URL('../fixtures/gree/', import.meta.url);

/** Every unit fixture, by file name without `.json`. */
export const FIXTURE_NAMES = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json') && name !== 'crypto-vectors.json')
  .map((name) => name.replace(/\.json$/, ''))
  .sort();

export function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8'));
}

let keySerial = 0;
/** A 16-character unit key, different at every binding. */
const newKey = () => `Kx${String((keySerial += 1)).padStart(4, '0')}fakeUnitKy`.slice(0, 16);

export class FakeGree {
  /**
   * @param {string} fixture name of a fixture file
   * @param {string} host IPv4 address of the unit
   */
  constructor(fixture, host) {
    this.fixture = fixture;
    this.host = host;
    const data = loadFixture(fixture);
    this.cipher = data.cipher;
    this.dev = structuredClone(data.dev);
    this.mac = data.dev.mac;
    this.hid = data.hid;
    this.props = structuredClone(data.status);
    this.key = newKey();
    this.online = true;
    // Datagrams to drop before answering again (UDP loss).
    this.drop = 0;
    // Refuse the binding (some units only accept it from the app).
    this.refuseBind = false;
    /** Decoded requests: `{ t }` for a scan, the inner pack otherwise. */
    this.received = [];
  }

  /** Reset the unit: it gets a new key, the old one opens nothing. */
  reset() {
    this.key = newKey();
  }

  seal(pack, key) {
    const { pack: encrypted, tag } = encryptPack(pack, key, this.cipher);
    const reply = { t: 'pack', i: 1, uid: 0, cid: this.mac, tcid: '', pack: encrypted };
    if (tag) {
      reply.tag = tag;
    }
    return reply;
  }

  /** The reply to one datagram, or null for no reply. */
  handle(datagram) {
    if (!this.online) {
      return null;
    }
    if (this.drop > 0) {
      this.drop -= 1;
      return null;
    }
    const message = JSON.parse(datagram.toString('utf8'));
    if (message.t === 'scan') {
      this.received.push({ t: 'scan' });
      return this.seal(this.dev, GENERIC_KEYS[this.cipher]);
    }
    if (message.t !== 'pack') {
      return null;
    }
    const key = message.i === 1 ? GENERIC_KEYS[this.cipher] : this.key;
    let pack;
    try {
      pack = decryptPack(message.pack, key, this.cipher, message.tag);
    } catch {
      // Like a real unit, a request it cannot read gets no answer.
      this.received.push({ t: 'undecryptable' });
      return null;
    }
    this.received.push(pack);
    switch (pack.t) {
      case 'bind':
        if (this.refuseBind) {
          return null;
        }
        return this.seal({ t: 'bindok', mac: this.mac, key: this.key, r: 200 }, key);
      case 'status': {
        const cols = pack.cols.filter(
          (name) => name in this.props || (name === 'hid' && this.hid !== undefined),
        );
        const dat = cols.map((name) => (name === 'hid' ? this.hid : this.props[name]));
        return this.seal({ t: 'dat', mac: this.mac, r: 200, cols, dat }, key);
      }
      case 'cmd': {
        pack.opt.forEach((name, index) => {
          this.props[name] = pack.p[index];
        });
        return this.seal(
          { t: 'res', mac: this.mac, r: 200, opt: pack.opt, p: pack.p, val: pack.p },
          key,
        );
      }
      default:
        return null;
    }
  }

  /** The requests of a type the unit received (`scan`, `bind`, `status`, `cmd`). */
  requests(type) {
    return this.received.filter((request) => request.t === type);
  }

  count(type) {
    return this.requests(type).length;
  }

  /** The reply to the discovery broadcast, as the Gladys core relays it. */
  scanReply() {
    const reply = this.handle(Buffer.from(JSON.stringify({ t: 'scan' })));
    return reply
      ? {
          source_ip: this.host,
          source_port: 7000,
          payload_base64: Buffer.from(JSON.stringify(reply)).toString('base64'),
        }
      : null;
  }
}

/**
 * A UDP network of fake units.
 * @param {FakeGree[]} units
 */
export function createNetwork(units) {
  const network = {
    units,
    sockets: [],
    byHost: (host) => network.units.find((unit) => unit.host === host),
    createSocket() {
      const socket = new EventEmitter();
      socket.bind = (port, callback) => setImmediate(callback);
      socket.unref = () => socket;
      socket.closed = false;
      socket.close = () => {
        socket.closed = true;
      };
      socket.send = (data, port, host, callback) => {
        setImmediate(() => callback?.(null));
        const unit = network.byHost(host);
        if (!unit || port !== 7000) {
          return;
        }
        const reply = unit.handle(Buffer.from(data));
        if (reply) {
          setImmediate(() => {
            if (!socket.closed) {
              socket.emit('message', Buffer.from(JSON.stringify(reply)), {
                address: host,
                port: 7000,
              });
            }
          });
        }
      };
      network.sockets.push(socket);
      return socket;
    },
    /** What the Gladys core would relay for a discovery broadcast. */
    scanReplies: () => network.units.map((unit) => unit.scanReply()).filter(Boolean),
  };
  return network;
}

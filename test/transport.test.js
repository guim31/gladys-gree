// -----------------------------------------------------------------------------
// The UDP client: retries, deadline, one exchange at a time per unit, replies
// matched on their address and type, another key told apart from silence.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPack } from '../src/gree/crypto.js';
import { GreeTransport } from '../src/gree/transport.js';
import { FakeGree, createNetwork } from './helpers/fakeGree.js';
import { CLASSIC, FAST_TRANSPORT, RECENT } from './helpers/world.js';

function setup(units) {
  const network = createNetwork(units);
  const transport = new GreeTransport({
    createSocket: network.createSocket,
    timings: FAST_TRANSPORT,
  });
  return { network, transport };
}

test('scan, bind, status and command with an ECB and a GCM unit', async (t) => {
  const classic = new FakeGree(CLASSIC, '192.0.2.10');
  const recent = new FakeGree(RECENT, '192.0.2.11');
  const { transport } = setup([classic, recent]);
  t.after(() => transport.close());
  for (const unit of [classic, recent]) {
    const info = await transport.scan(unit.host);
    assert.equal(info.mac, unit.mac);
    assert.equal(info.cipher, unit.cipher);
    const key = await transport.bind(unit.host, info);
    assert.equal(key, unit.key);
    const bound = { mac: unit.mac, key, cipher: info.cipher };
    const props = await transport.status(unit.host, bound, ['Pow', 'SetTem', 'Nope']);
    assert.deepEqual(props, { Pow: unit.props.Pow, SetTem: unit.props.SetTem });
    assert.deepEqual(await transport.command(unit.host, bound, { SetTem: 26 }), { SetTem: 26 });
    assert.equal(unit.props.SetTem, 26);
  }
});

test('lost datagrams are sent again until the reply', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const { transport } = setup([unit]);
  t.after(() => transport.close());
  unit.drop = 2;
  assert.equal((await transport.scan(unit.host)).mac, unit.mac);
  assert.equal(unit.count('scan'), 1, 'two copies lost, the third answered');
});

test('silence is a timeout; an answer with another key is told apart', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const { transport } = setup([unit]);
  t.after(() => transport.close());
  const bound = { mac: unit.mac, key: unit.key, cipher: 'ecb' };
  unit.online = false;
  await assert.rejects(transport.status(unit.host, bound), (err) => {
    assert.equal(err.kind, 'timeout');
    assert.equal(err.unreachable, true);
    return true;
  });
  unit.online = true;
  // A unit answering with a key the integration does not have.
  unit.handle = () => ({
    t: 'pack',
    i: 0,
    cid: unit.mac,
    ...encryptPack({ t: 'dat', cols: [], dat: [] }, 'zzzzzzzzzzzzzzzz', 'ecb'),
  });
  await assert.rejects(transport.status(unit.host, bound), (err) => {
    assert.equal(err.kind, 'bad-key');
    assert.equal(err.unreachable, false);
    return true;
  });
});

test('one exchange at a time per unit: replies never cross', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const { transport } = setup([unit]);
  t.after(() => transport.close());
  const bound = { mac: unit.mac, key: unit.key, cipher: 'ecb' };
  const [scan, status, command] = await Promise.all([
    transport.scan(unit.host),
    transport.status(unit.host, bound, ['Pow']),
    transport.command(unit.host, bound, { Pow: 0 }),
  ]);
  assert.equal(scan.mac, unit.mac);
  assert.deepEqual(status, { Pow: 1 });
  assert.deepEqual(command, { Pow: 0 });
  assert.deepEqual(
    unit.received.map((request) => request.t),
    ['scan', 'status', 'cmd'],
  );
});

test('a datagram from another address or not JSON is ignored; close ends the waits', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const { network, transport } = setup([unit]);
  t.after(() => transport.close());
  unit.online = false;
  const waiting = transport.scan(unit.host);
  while (network.sockets.length === 0 || !transport.pending.has(unit.host)) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const [socket] = network.sockets;
  socket.emit('message', Buffer.from('nope'), { address: unit.host, port: 7000 });
  socket.emit('message', Buffer.from('{"t":"pack"}'), { address: '192.0.2.99', port: 7000 });
  transport.close();
  await assert.rejects(waiting, (err) => err.kind === 'socket');
  await assert.rejects(transport.scan(unit.host), (err) => err.kind === 'socket');
});

test('real UDP sockets: a simulated unit on the loopback answers the real client', async (t) => {
  const { createSocket } = await import('node:dgram');
  const unit = new FakeGree(RECENT, '127.0.0.1');
  const server = createSocket('udp4');
  server.on('message', (data, remote) => {
    const reply = unit.handle(data);
    if (reply) {
      server.send(Buffer.from(JSON.stringify(reply)), remote.port, remote.address);
    }
  });
  await new Promise((resolve) => server.bind(0, '127.0.0.1', resolve));
  const transport = new GreeTransport({ port: server.address().port, timings: FAST_TRANSPORT });
  t.after(() => {
    transport.close();
    server.close();
  });
  const info = await transport.scan('127.0.0.1');
  assert.equal(info.cipher, 'gcm');
  const key = await transport.bind('127.0.0.1', info);
  const props = await transport.status('127.0.0.1', { mac: info.mac, key, cipher: 'gcm' });
  assert.equal(props.SetTem, 21);
});

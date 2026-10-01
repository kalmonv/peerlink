import { test, expect, beforeAll, afterAll } from 'vitest';
import { startLocalTracker } from './helpers/local-tracker.js';
import Peerlink from '../src/node.js';

let tracker;
beforeAll(async () => { tracker = await startLocalTracker(8011); });
afterAll(() => new Promise(resolve => tracker.close(resolve)));

test('Connects, sends messages, supports chained replies and chunking', async () => {
  const p1 = new Peerlink({
    identifier: 'test-msg',
    trackers: ['ws://localhost:8011'],
    rtcConfig: { iceServers: [] }
  });
  const p2 = new Peerlink({
    identifier: 'test-msg',
    trackers: ['ws://localhost:8011'],
    rtcConfig: { iceServers: [] }
  });

  p2.on('msg', async (peer, msg) => {
    if (msg.data === 'ping') {
      await msg.reply('pong');
    } else if (msg.data === 'how-are-you') {
      await msg.reply('how-are-you-ack');
    }
  });

  await Promise.all([p1.start(), p2.start()]);

  // Wait for connection and test short message with reply
  await new Promise((resolve) => {
    p1.on('peerconnect', async (peer) => {
      const [_, reply] = await p1.send(peer, 'ping', { awaitReply: true });
      expect(reply).toBe('pong');
      resolve();
    });
  });

  // Chained respond
  const peer1 = Array.from(p1.peers.values())[0];
  const [_, res] = await peer1.respond('how-are-you');
  expect(res).toBe('how-are-you-ack');

  // Test chunking with larger payload (e.g., 600 KB to exceed 512KB window)
  const largeData = 'A'.repeat(600 * 1024);
  const receivedLarge = new Promise(resolve => {
    p2.on('msg', (peer, msg) => {
      if (typeof msg.data === 'string' && msg.data.length === 600 * 1024) {
        resolve(msg.data);
      }
    });
  });

  await p1.send(peer1, largeData);
  const receivedData = await receivedLarge;
  expect(receivedData.length).toBe(largeData.length);

  p1.destroy();
  p2.destroy();
}, 25000);
test.beforeEach?.();
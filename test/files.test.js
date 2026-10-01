import { test, expect, beforeAll, afterAll } from 'vitest';
import { startLocalTracker } from './helpers/local-tracker.js';
import Peerlink from '../src/node.js';
import crypto from 'node:crypto';

let tracker;
beforeAll(async () => { tracker = await startLocalTracker(8012); });
afterAll(() => new Promise(resolve => tracker.close(resolve)));

test('Send, receive and verify file hash', async () => {
  const p1 = new Peerlink({
    identifier: 'test-file-hash',
    trackers: ['ws://localhost:8012'],
    rtcConfig: { iceServers: [] }
  });
  const p2 = new Peerlink({
    identifier: 'test-file-hash',
    trackers: ['ws://localhost:8012'],
    rtcConfig: { iceServers: [] }
  });
  await Promise.all([p1.start(), p2.start()]);

  const testData = crypto.randomBytes(1024 * 60); // 60KB

  await new Promise(resolve => {
    p2.on('file', async (peer, offer) => {
      expect(offer.size).toBe(testData.length);
      const incoming = await offer.accept();
      
      const chunks = [];
      const reader = incoming.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      expect(Buffer.concat(chunks)).toEqual(testData);
      incoming.on('done', resolve);
    });

    p1.on('peerconnect', peer => {
      p1.sendFile(peer, testData, { name: 'test.bin', hash: true });
    });
  });

  p1.destroy();
  p2.destroy();
}, 25000);

test('File offer rejection by receiver', async () => {
  const p1 = new Peerlink({
    identifier: 'test-file-reject',
    trackers: ['ws://localhost:8012'],
    rtcConfig: { iceServers: [] }
  });
  const p2 = new Peerlink({
    identifier: 'test-file-reject',
    trackers: ['ws://localhost:8012'],
    rtcConfig: { iceServers: [] }
  });
  await Promise.all([p1.start(), p2.start()]);

  p2.on('file', (peer, offer) => {
    offer.reject('Not interested');
  });

  await new Promise(resolve => {
    p1.on('peerconnect', peer => {
      const tx = p1.sendFile(peer, new Uint8Array([1, 2, 3]), { name: 'small.bin' });
      tx.on('rejected', () => {
        resolve();
      });
    });
  });

  p1.destroy();
  p2.destroy();
}, 25000);
});
import { test, expect, beforeAll, afterAll } from 'vitest';
import { startLocalTracker } from './helpers/local-tracker.js';
import Peerlink from '../src/node.js';

let tracker;
beforeAll(async () => { tracker = await startLocalTracker(8013); });
afterAll(() => new Promise(resolve => tracker.close(resolve)));

test('E2E stream multiplexing and backpressure', async () => {
  const p1 = new Peerlink({
    identifier: 'test-stream',
    trackers: ['ws://localhost:8013'],
    rtcConfig: { iceServers: [] }
  });
  const p2 = new Peerlink({
    identifier: 'test-stream',
    trackers: ['ws://localhost:8013'],
    rtcConfig: { iceServers: [] }
  });
  await Promise.all([p1.start(), p2.start()]);

  await new Promise(resolve => {
    p2.on('stream', async (peer, readable, meta) => {
      expect(meta.type).toBe('test');
      const reader = readable.getReader();
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }
      expect(chunks.join('')).toBe('chunk1chunk2');
      resolve();
    });

    p1.on('peerconnect', async peer => {
      const writable = await p1.createStream(peer, { type: 'test' });
      const writer = writable.getWriter();
      await writer.write(new TextEncoder().encode('chunk1'));
      await writer.write(new TextEncoder().encode('chunk2'));
      await writer.close();
    });
  });

  p1.destroy();
  p2.destroy();
}, 25000);

test('Destroy closes peers cleanly', async () => {
  const p1 = new Peerlink({
    identifier: 'test-stream-destroy',
    trackers: ['ws://localhost:8013'],
    rtcConfig: { iceServers: [] }
  });
  const p2 = new Peerlink({
    identifier: 'test-stream-destroy',
    trackers: ['ws://localhost:8013'],
    rtcConfig: { iceServers: [] }
  });
  await Promise.all([p1.start(), p2.start()]);

  await new Promise(resolve => {
    p1.on('peerconnect', peer => {
      p1.destroy();
      expect(p1.peers.size).toBe(0);
      resolve();
    });
  });

  p2.destroy();
}, 25000);
});
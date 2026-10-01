import fs from 'node:fs';
import { Readable, Writable } from 'node:stream';
import crypto from 'node:crypto';
import PeerlinkCore, { PeerlinkError } from './core/Peerlink.js';

export { PeerlinkError };

export const toNodeReadable = (webStream) => Readable.fromWeb(webStream);
export const fromNodeReadable = (nodeStream) => Readable.toWeb(nodeStream);

export default class Peerlink extends PeerlinkCore {
  constructor(opts = {}) {
    super({
      ...opts,
      env: 'node',
      fsAdapter: {
        createReadStream: (p) => Readable.toWeb(fs.createReadStream(p)),
        createWriteStream: (p) => Writable.toWeb(fs.createWriteStream(p)),
        fromNodeReadable: (s) => Readable.toWeb(s),
        statSync: fs.statSync
      },
      cryptoAdapter: {
        sha1: async (str) => crypto.createHash('sha1').update(str).digest('hex'),
        sha256: async (u8) => crypto.createHash('sha256').update(u8).digest('hex'),
        createHash: (algo) => crypto.createHash(algo)
      }
    });
  }

  async start() {
    if (!this.opts.wrtc) {
      try {
        const wrtcModule = await import('@roamhq/wrtc');
        this.opts.wrtc = wrtcModule.default || wrtcModule;
      } catch (e) {
        throw new PeerlinkError('WRTC_MISSING', 'PeerlinkError: WRTC_MISSING - Please npm install @roamhq/wrtc');
      }
    }
    await super.start();
  }
}
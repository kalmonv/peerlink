import PeerlinkCore, { PeerlinkError } from './core/Peerlink.js';

export { PeerlinkError };

export default class Peerlink extends PeerlinkCore {
  constructor(opts = {}) {
    super({
      ...opts,
      env: 'browser',
      wrtc: undefined, // uses native WebRTC
      cryptoAdapter: {
        sha1: async (str) => {
          const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
          return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
        },
        sha256: async (u8) => {
          const hash = await crypto.subtle.digest('SHA-256', u8);
          return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
      }
    });
  }
}

import Emitter from './emitter.js';
import PeerHandle from './PeerHandle.js';
import { createTrackerClient } from './tracker.js';
import { randomHex } from './utils.js';
import { PeerlinkError } from './errors.js';

export { PeerlinkError };

export default class Peerlink extends Emitter {
  constructor(opts = {}) {
    super();
    this.opts = {
      trackers: ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev'],
      chunkSize: 16 * 1024,
      ...opts
    };
    if (this.opts.chunkSize > 64 * 1024) throw new Error('chunkSize max 64KB');
    
    this.id = randomHex(20);
    this.peers = new Map();
    this.client = null;
    this.PeerHandle = PeerHandle;
    this._announceTimer = null;
  }

  setIdentifier(str) { this.opts.identifier = str; }

  async start() {
    if (!this.opts.identifier) throw new Error('Identifier required');
    const cryptoAdp = this.opts.cryptoAdapter;
    const infoHashHex = await cryptoAdp.sha1(this.opts.identifier);
    if (this.client) {
      try { this.client.destroy(); } catch (e) {}
    }

    return new Promise((resolve) => {
      this.client = createTrackerClient(this, infoHashHex, this.id);
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      this.client.once('update', finish);
      setTimeout(finish, 1500);

      clearInterval(this._announceTimer);
      this._announceTimer = setInterval(() => {
        if (this.client && this.peers.size === 0) {
          this.client.update();
        }
      }, 1500);
      if (this._announceTimer.unref) this._announceTimer.unref();
    });
  }

  destroy() {
    clearInterval(this._announceTimer);
    this._announceTimer = null;

    const activePeers = Array.from(this.peers.values());
    for (const peer of activePeers) {
      try { peer.close(); } catch (e) {}
    }
    this.peers.clear();

    if (this.client) {
      try { this.client.destroy(); } catch (e) {}
      this.client = null;
    }
    this.removeAllListeners();
  }

  requestMorePeers() {
    return new Promise(resolve => {
      if (!this.client) return resolve(this.peers);
      this.client.update();
      setTimeout(() => resolve(this.peers), 1000);
    });
  }

  send(peer, msg, opts) { return peer.msg.send(msg, opts); }
  sendFile(peer, source, opts) { return peer.files.sendFile(source, opts); }
  createStream(peer, meta) { return peer.streams.createStream(meta); }
  
  // <-- Nova Função de Mídia (Áudio/Vídeo)
  sendMedia(peer, stream, meta) { return peer.media.sendMedia(stream, meta); } 
}
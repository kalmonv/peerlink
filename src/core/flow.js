import Emitter from './emitter.js';
import { TYPES } from './protocol.js';
import { PeerlinkError } from './errors.js';

export default class FlowController extends Emitter {
  constructor(peerHandle, initialWindow = 512 * 1024) {
    super();
    this.peer = peerHandle;
    this.initialWindow = initialWindow;
    this.credits = new Map(); // channelId -> bytes
    this.localHighWatermark = 256 * 1024;
  }

  getCredits(channelId) {
    if (!this.credits.has(channelId)) this.credits.set(channelId, this.initialWindow);
    return this.credits.get(channelId);
  }

  addCredits(channelId, amount) {
    this.credits.set(channelId, this.getCredits(channelId) + amount);
    this.emit(`credit:${channelId}`);
  }

  async acquire(channelId, size) {
    while (this.getCredits(channelId) < size) {
      if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer closed');
      await new Promise((resolve, reject) => {
        const onCredit = () => {
          cleanup();
          resolve();
        };
        const onClose = () => {
          cleanup();
          reject(new PeerlinkError('PEER_CLOSED', 'Peer closed'));
        };
        const cleanup = () => {
          this.off(`credit:${channelId}`, onCredit);
          this.peer.off('close', onClose);
        };
        this.once(`credit:${channelId}`, onCredit);
        this.peer.once('close', onClose);
      });
    }
    this.credits.set(channelId, this.getCredits(channelId) - size);
    await this.waitLocalBuffer();
  }

async waitLocalBuffer() {
    const channel = this.peer.channel || this.peer.peer?._channel;
    if (!channel || channel.readyState !== 'open') return;
    
    if (channel.bufferedAmount > this.localHighWatermark) {
      if (!channel.bufferedAmountLowThreshold) {
        channel.bufferedAmountLowThreshold = 64 * 1024;
      }
      
      await new Promise(resolve => {
        let fallbackCheck;

        const onLow = () => {
          cleanup();
          resolve();
        };
        
        const onClose = () => {
          cleanup();
          resolve();
        };
        
        const cleanup = () => {
          clearInterval(fallbackCheck);
          channel.removeEventListener('bufferedamountlow', onLow);
          this.peer.off('close', onClose);
        };
        
        channel.addEventListener('bufferedamountlow', onLow);
        this.peer.once('close', onClose);

        // Fallback: se o evento nativo falhar, verifica manualmente a cada 50ms
        fallbackCheck = setInterval(() => {
          if (channel.readyState !== 'open' || channel.bufferedAmount <= 64 * 1024) {
            cleanup();
            resolve();
          }
        }, 50);
      });
    }
  }

  sendCredits(channelId, amount) {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer, buf.byteOffset).setUint32(0, amount, false);
    this.peer.sendRaw(TYPES.CREDIT, 0, channelId, 0, buf);
  }

  destroy() {
    this.credits.clear();
    this.removeAllListeners();
  }
}

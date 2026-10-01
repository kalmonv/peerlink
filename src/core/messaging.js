import { TYPES, FLAGS } from './protocol.js';
import { concatUint8, encodeJSON } from './utils.js';
import { PeerlinkError } from './errors.js';

export class MessagingHandler {
  constructor(peer) {
    this.peer = peer;
    this.inFlight = new Map();
    this.recvBuffers = new Map();
  }

  async send(data, opts = {}) {
    if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer is closed');
    const channelId = this.peer.nextChannelId();
    await this._sendChunks(TYPES.MSG, channelId, data);
    if (!opts.awaitReply) return [this.peer, null];

    return new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        this.inFlight.delete(channelId);
        reject(new PeerlinkError('TIMEOUT', 'Message timed out waiting for reply'));
      }, this.peer.core.opts.messageTimeout || 30000);
      
      this.inFlight.set(channelId, { resolve, reject, to });
    });
  }

  async _sendChunks(type, channelId, data, replyTo = null) {
    let payload, subType;
    if (typeof data === 'string') { payload = new TextEncoder().encode(data); subType = 0; }
    else if (data instanceof Uint8Array) { payload = data; subType = 2; }
    else { payload = encodeJSON(data); subType = 1; }

    const cs = this.peer.core.opts.chunkSize;
    let offset = 0, seq = 0;
    
    while (offset < payload.length || seq === 0) {
      if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer closed during transmission');
      const isFirst = seq === 0;
      let chunkLen = Math.min(payload.length - offset, cs - (isFirst ? 1 : 0) - (replyTo && isFirst ? 4 : 0));
      if (chunkLen < 0) chunkLen = 0;
      
      const isFin = (offset + chunkLen) >= payload.length;
      let chunk = new Uint8Array(chunkLen + (isFirst ? 1 : 0) + (isFirst && replyTo ? 4 : 0));
      let ptr = 0;

      if (isFirst && replyTo) {
        new DataView(chunk.buffer, chunk.byteOffset).setUint32(ptr, replyTo, false);
        ptr += 4;
      }
      if (isFirst) { chunk[ptr++] = subType; }
      chunk.set(payload.subarray(offset, offset + chunkLen), ptr);

      await this.peer.flow.acquire(channelId, chunk.length);
      this.peer.sendRaw(type, isFin ? FLAGS.FIN : 0, channelId, seq++, chunk);
      offset += chunkLen;
    }
  }

  handleMsg(frame, isReply) {
    let bufList = this.recvBuffers.get(frame.channelId);
    if (!bufList) { bufList = []; this.recvBuffers.set(frame.channelId, bufList); }
    bufList.push(frame.payload);

    // Replenish credit back to sender for large messages
    this.peer.flow.sendCredits(frame.channelId, frame.payload.length);

    if (frame.flags & FLAGS.FIN) {
      this.recvBuffers.delete(frame.channelId);
      const full = concatUint8(bufList);
      let ptr = 0, replyTo = null;
      
      if (isReply) {
        replyTo = new DataView(full.buffer, full.byteOffset).getUint32(ptr, false);
        ptr += 4;
      }
      const subType = full[ptr++];
      const dataBytes = full.subarray(ptr);
      
      let data = dataBytes;
      if (subType === 0) data = new TextDecoder().decode(dataBytes);
      else if (subType === 1) {
        try {
          data = JSON.parse(new TextDecoder().decode(dataBytes));
        } catch (e) {
          this.peer.core.emit('error', new PeerlinkError('PROTOCOL', 'Invalid JSON payload'));
          return;
        }
      }

      if (isReply && replyTo !== null && this.inFlight.has(replyTo)) {
        const req = this.inFlight.get(replyTo);
        clearTimeout(req.to);
        this.inFlight.delete(replyTo);
        req.resolve([this.peer, data]);
      } else if (!isReply) {
        const msgObj = {
          id: frame.channelId,
          data,
          reply: async (replyPayload, replyOpts = {}) => {
            const replyChannelId = this.peer.nextChannelId();
            await this._sendChunks(TYPES.MSG_REPLY, replyChannelId, replyPayload, frame.channelId);
            if (!replyOpts.awaitReply) return [this.peer, null];
            return new Promise((resolve, reject) => {
              const to = setTimeout(() => {
                this.inFlight.delete(replyChannelId);
                reject(new PeerlinkError('TIMEOUT', 'Reply timeout'));
              }, this.peer.core.opts.messageTimeout || 30000);
              this.inFlight.set(replyChannelId, { resolve, reject, to });
            });
          }
        };
        this.peer.core.emit('msg', this.peer, msgObj);
      }
    }
  }

  destroy() {
    for (const [channelId, req] of this.inFlight.entries()) {
      clearTimeout(req.to);
      req.reject(new PeerlinkError('PEER_CLOSED', 'Peer closed'));
    }
    this.inFlight.clear();
    this.recvBuffers.clear();
  }
}

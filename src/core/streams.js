import { TYPES, FLAGS } from './protocol.js';
import { encodeJSON, decodeJSON } from './utils.js';
import { PeerlinkError } from './errors.js';

export class StreamsHandler {
  constructor(peer) {
    this.peer = peer;
    this.streams = new Map(); // channelId -> { controller }
    this.writers = new Map(); // channelId -> { abort }
  }

  async createStream(meta = {}) {
    if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer closed');
    const channelId = this.peer.nextChannelId();
    let seq = 0;
    
    this.peer.sendRaw(TYPES.STREAM_OPEN, 0, channelId, 0, encodeJSON(meta));

    const writable = new WritableStream({
      write: async (chunk) => {
        if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer closed');
        let u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        let offset = 0;
        const cs = this.peer.core.opts.chunkSize;
        while (offset < u8.length) {
          if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer closed');
          const slice = u8.subarray(offset, offset + cs);
          await this.peer.flow.acquire(channelId, slice.length);
          this.peer.sendRaw(TYPES.STREAM_DATA, 0, channelId, seq++, slice);
          offset += slice.length;
        }
      },
      close: () => {
        this.writers.delete(channelId);
        this.peer.sendRaw(TYPES.STREAM_END, FLAGS.FIN, channelId, seq);
      },
      abort: (reason) => {
        this.writers.delete(channelId);
        this.peer.sendRaw(TYPES.ABORT, 0, channelId, 0, encodeJSON({ reason: String(reason || 'ABORTED') }));
      }
    });

    this.writers.set(channelId, writable);
    return writable;
  }

  handleOpen(frame) {
    let meta = {};
    try {
      meta = decodeJSON(frame.payload);
    } catch (e) {
      meta = {};
    }
    const channelId = frame.channelId;
    let controller;
    
    const readable = new ReadableStream({
      start(c) { controller = c; },
      pull: () => {
        this.peer.flow.sendCredits(channelId, this.peer.core.opts.chunkSize * 4);
      },
      cancel: (reason) => {
        this.streams.delete(channelId);
        this.peer.sendRaw(TYPES.ABORT, 0, channelId, 0, encodeJSON({ reason: String(reason || 'ABORTED') }));
      }
    });

    this.streams.set(channelId, { controller, readable });
    this.peer.core.emit('stream', this.peer, readable, meta);
  }

  handleData(frame) {
    const s = this.streams.get(frame.channelId);
    if (s && s.controller) {
      try {
        s.controller.enqueue(frame.payload);
      } catch (e) {
        // Stream might already be closed or errored
      }
    }
  }

  handleEnd(frame) {
    const s = this.streams.get(frame.channelId);
    if (s && s.controller) {
      try {
        s.controller.close();
      } catch (e) {}
      this.streams.delete(frame.channelId);
    }
  }

  handleAbort(frame) {
    const channelId = frame.channelId;
    const s = this.streams.get(channelId);
    if (s && s.controller) {
      try {
        s.controller.error(new PeerlinkError('ABORTED', 'Stream aborted by remote peer'));
      } catch (e) {}
      this.streams.delete(channelId);
    }
    this.writers.delete(channelId);
  }

  destroy() {
    for (const [channelId, s] of this.streams.entries()) {
      try {
        s.controller.error(new PeerlinkError('PEER_CLOSED', 'Peer closed'));
      } catch (e) {}
    }
    this.streams.clear();
    this.writers.clear();
  }
}

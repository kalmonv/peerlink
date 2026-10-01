import Emitter from './emitter.js';
import FlowController from './flow.js';
import { MessagingHandler } from './messaging.js';
import { FileHandler } from './files.js';
import { StreamsHandler } from './streams.js';
import { MediaHandler } from './media.js';
import { TYPES, decodeFrame, encodeFrame } from './protocol.js';
import { encodeJSON, decodeJSON } from './utils.js';
import { PeerlinkError } from './errors.js';

export default class PeerHandle extends Emitter {
  constructor(core, simplePeer) {
    super();
    this.core = core;
    this.peer = simplePeer;
    this.channel = simplePeer._channel || null;
    this.closed = false;
    this.id = simplePeer.id || null;
    this.latency = 0;
    this._channelCounter = Math.floor(Math.random() * 100000);
    
    this.flow = new FlowController(this);
    this.msg = new MessagingHandler(this);
    this.files = new FileHandler(this);
    this.streams = new StreamsHandler(this);
    this.media = new MediaHandler(this);

    this.peer.on('data', d => this._onData(d));
    this.peer.on('close', () => this.close());
    this.peer.on('error', (err) => {
      this.close();
    });

    this.peer.on('signal', data => {
      if (this.peer.connected && !this.closed) {
        this.sendRaw(TYPES.RENEGOTIATE, 0, 0, 0, encodeJSON(data));
      }
    });

    // Intercepta o stream nativo completo de áudio/vídeo
    this.peer.on('stream', stream => {
      this.media.handleStream(stream);
    });

    if (this.peer.connected) {
      this._onConnect();
    } else {
      this.peer.once('connect', () => this._onConnect());
    }
  }

  _onConnect() {
    if (this.closed) return;
    this.channel = this.peer._channel;
    this.sendRaw(TYPES.HELLO, 0, 0, 0, encodeJSON({ id: this.core.id }));
  }

  nextChannelId() { return ++this._channelCounter; }

  respond(msg, opts = {}) {
    return this.msg.send(msg, { ...opts, awaitReply: true });
  }

  sendRaw(type, flags, channelId, seq, payload = null) {
    if (this.closed || !this.peer.connected) return;
    try {
      this.peer.send(encodeFrame(type, flags, channelId, seq, payload));
    } catch (e) {
      this.close();
    }
  }

  _onData(data) {
    if (this.closed) return;
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const frame = decodeFrame(u8);
    if (!frame) {
      this.core.emit('error', new PeerlinkError('PROTOCOL', 'Malformed binary frame received'));
      return;
    }

    if (frame.type === TYPES.HELLO) {
      let remoteId;
      try {
        remoteId = decodeJSON(frame.payload).id;
      } catch (e) {
        this.core.emit('error', new PeerlinkError('PROTOCOL', 'Invalid HELLO payload'));
        return;
      }

      if (remoteId === this.core.id) {
        this.close();
        return;
      }

      if (this.core.peers.has(remoteId) && this.core.peers.get(remoteId) !== this) {
        this.close();
        return;
      }

      this.id = remoteId;
      this.core.peers.set(this.id, this);
      this.core.emit('peerconnect', this);
      return;
    }
    
    if (frame.type === TYPES.CREDIT) {
      if (frame.payload && frame.payload.byteLength >= 4) {
        const amount = new DataView(frame.payload.buffer, frame.payload.byteOffset).getUint32(0, false);
        this.flow.addCredits(frame.channelId, amount);
      }
      return;
    }

    if (frame.type === TYPES.MSG) {
      this.msg.handleMsg(frame, false);
    } else if (frame.type === TYPES.MSG_REPLY) {
      this.msg.handleMsg(frame, true);
    } else if (frame.type === TYPES.FILE_OFFER) {
      this.files.handleOffer(frame);
    } else if (frame.type >= 0x11 && frame.type <= 0x14) {
      this.files.handleControl(frame.type, frame);
    } else if (frame.type === TYPES.STREAM_OPEN) {
      this.streams.handleOpen(frame);
    } else if (frame.type === TYPES.STREAM_DATA) {
      this.streams.handleData(frame);
    } else if (frame.type === TYPES.STREAM_END) {
      this.streams.handleEnd(frame);
    } else if (frame.type === TYPES.ABORT) {
      this.files.handleControl(frame.type, frame);
      this.streams.handleAbort(frame);
    } else if (frame.type === TYPES.MEDIA_INFO) {
      this.media.handleMediaInfo(frame);
    } else if (frame.type === TYPES.RENEGOTIATE) {
      try {
        const signalData = decodeJSON(frame.payload);
        this.peer.signal(signalData);
      } catch (e) {}
    } else {
      this.core.emit('error', new PeerlinkError('PROTOCOL', `Unknown frame type: ${frame.type}`));
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.id && this.core.peers.get(this.id) === this) {
      this.core.peers.delete(this.id);
    }
    this.flow.destroy();
    this.msg.destroy();
    this.files.destroy();
    this.streams.destroy();
    this.media.destroy();

    try {
      this.peer.destroy();
    } catch (e) {}

    this.emit('close');
    this.core.emit('peerclose', this);
  }
}
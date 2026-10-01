import { TYPES } from './protocol.js';
import { encodeJSON, decodeJSON } from './utils.js';
import { PeerlinkError } from './errors.js';

export class MediaHandler {
  constructor(peerHandle) {
    this.peer = peerHandle;
    this.pendingMeta = new Map();
    this.activeStreams = new Set();
  }

  sendMedia(stream, meta = {}) {
    if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer closed');
    
    const streamId = stream.id;
    
    // 1. Envia os metadados
    this.peer.sendRaw(TYPES.MEDIA_INFO, 0, 0, 0, encodeJSON({
      id: streamId,
      meta: meta
    }));

    // 2. Injeta o stream inteiro, o que forçará o disparo de um evento 'signal' para renegociação
    this.peer.peer.addStream(stream);

    // 3. Controlo de encerramento
    return {
      stream,
      stop: () => {
        stream.getTracks().forEach(track => track.stop());
        try { 
          this.peer.peer.removeStream(stream); 
        } catch (e) {}
      }
    };
  }

  handleMediaInfo(frame) {
    try {
      const data = decodeJSON(frame.payload);
      this.pendingMeta.set(data.id, data.meta);
    } catch (e) {
      this.peer.core.emit('error', new PeerlinkError('PROTOCOL', 'Invalid MEDIA_INFO payload'));
    }
  }

  handleStream(stream) {
    if (!this.activeStreams.has(stream.id)) {
      this.activeStreams.add(stream.id);
      this._waitForMetaAndEmit(stream);
    }
  }

  _waitForMetaAndEmit(stream) {
    let attempts = 0;
    
    const check = () => {
      if (this.pendingMeta.has(stream.id)) {
        const meta = this.pendingMeta.get(stream.id);
        this.pendingMeta.delete(stream.id);
        this.peer.core.emit('media', this.peer, stream, meta);
      } else if (attempts < 50) { 
        attempts++;
        setTimeout(check, 50);
      } else {
        // Fallback: emite com metadados genéricos caso haja atraso na rede
        this.peer.core.emit('media', this.peer, stream, { type: 'Mídia Desconhecida' });
      }
    };
    
    check();
  }

  destroy() {
    this.pendingMeta.clear();
    this.activeStreams.clear();
  }
}
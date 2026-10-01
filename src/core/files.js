import { TYPES, FLAGS } from './protocol.js';
import { encodeJSON, decodeJSON, concatUint8 } from './utils.js';
import { PeerlinkError } from './errors.js';
import Emitter from './emitter.js';

export class FileHandler {
  constructor(peer) {
    this.peer = peer;
    this.transfers = new Map(); // channelId -> transfer info
  }

  sendFile(source, opts = {}) {
    if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer closed');
    const channelId = this.peer.nextChannelId();
    const env = this.peer.core.opts.env;
    let name = opts.name || 'file';
    let size = opts.size || 0;
    let streamFactory = null;

    if (typeof Blob !== 'undefined' && source instanceof Blob) {
      size = size || source.size;
      name = opts.name || source.name || 'file';
      streamFactory = () => source.stream();
    } else if (typeof source === 'string') {
      const fs = this.peer.core.opts.fsAdapter;
      if (!fs) throw new Error('fsAdapter not available for string path');
      size = size || fs.statSync(source).size;
      const baseName = source.replace(/\\/g, '/').split('/').pop() || 'file';
      name = opts.name || baseName;
      streamFactory = () => fs.createReadStream(source);
    } else if (source && typeof source === 'object' && typeof source.pipe === 'function') {
      // Node Readable stream
      const fs = this.peer.core.opts.fsAdapter;
      if (fs && fs.fromNodeReadable) {
        streamFactory = () => fs.fromNodeReadable(source);
      } else {
        throw new Error('Node stream source requires fromNodeReadable in fsAdapter');
      }
    } else if (source && typeof source.getReader === 'function') {
      // ReadableStream
      streamFactory = () => source;
    } else if (source instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(source))) {
      const u8 = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      size = size || u8.length;
      streamFactory = () => new ReadableStream({
        start(c) { c.enqueue(u8); c.close(); }
      });
    } else {
      throw new Error('Unsupported file source');
    }

    const tx = new Emitter();
    tx.id = channelId;
    let canceled = false;
    let cancelReason = 'canceled';
    let currentReader = null;

    tx.cancel = (reason = 'canceled') => {
      if (canceled) return;
      canceled = true;
      cancelReason = reason;
      this.peer.sendRaw(TYPES.ABORT, 0, channelId, 0, encodeJSON({ reason }));
      if (currentReader) {
        try { currentReader.cancel(reason); } catch (e) {}
      }
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        tx.cancel('AbortSignal triggered');
      } else {
        opts.signal.addEventListener('abort', () => tx.cancel('AbortSignal triggered'), { once: true });
      }
    }

    tx.promise = new Promise((resolve, reject) => {
      this.transfers.set(channelId, {
        accept: async () => {
          tx.emit('accepted');
          let hashCtx = null;
          let fullChunks = [];

          if (opts.hash) {
            if (this.peer.core.opts.cryptoAdapter?.createHash) {
              hashCtx = this.peer.core.opts.cryptoAdapter.createHash('sha256');
            }
          }

          try {
            const readable = streamFactory();
            const reader = readable.getReader();
            currentReader = reader;
            let seq = 0, sent = 0;
            const cs = this.peer.core.opts.chunkSize;
            const startTime = Date.now();

            while (true) {
              if (canceled) throw new PeerlinkError('ABORTED', cancelReason);
              if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer closed');

              const { done, value } = await reader.read();
              if (done) break;

              let offset = 0;
              while (offset < value.length) {
                if (canceled) throw new PeerlinkError('ABORTED', cancelReason);
                if (this.peer.closed) throw new PeerlinkError('PEER_CLOSED', 'Peer closed');

                const chunk = value.subarray(offset, offset + cs);
                await this.peer.flow.acquire(channelId, chunk.length);
                this.peer.sendRaw(TYPES.FILE_DATA, 0, channelId, seq++, chunk);
                offset += chunk.length;
                sent += chunk.length;

                const elapsed = (Date.now() - startTime) / 1000;
                const speed = elapsed > 0 ? Math.round(sent / elapsed) : 0;
                tx.emit('progress', { sent, total: size, speed });
              }

              if (hashCtx) hashCtx.update(value);
              else if (opts.hash && env === 'browser') fullChunks.push(value);
            }

            let computedHash = null;
            if (hashCtx) {
              computedHash = hashCtx.digest('hex');
            } else if (opts.hash && env === 'browser' && fullChunks.length > 0) {
              computedHash = await this.peer.core.opts.cryptoAdapter.sha256(concatUint8(fullChunks));
            }

            this.peer.sendRaw(TYPES.FILE_END, FLAGS.FIN, channelId, seq, encodeJSON({ sha256: computedHash }));
            resolve();
            tx.emit('done');
          } catch (e) {
            reject(e);
            tx.emit('error', e);
          } finally {
            this.transfers.delete(channelId);
          }
        },
        reject: (reason) => {
          const err = new PeerlinkError('REJECTED', reason || 'Transfer rejected by remote peer');
          reject(err);
          tx.emit('rejected');
          this.transfers.delete(channelId);
        },
        abort: (reason) => {
          const err = new PeerlinkError('ABORTED', reason || 'Transfer aborted');
          reject(err);
          tx.emit('error', err);
          this.transfers.delete(channelId);
        }
      });

      this.peer.sendRaw(TYPES.FILE_OFFER, 0, channelId, 0, encodeJSON({
        name,
        size,
        mime: opts.mime || 'application/octet-stream',
        hash: !!opts.hash
      }));
    });

    return tx;
  }

  handleOffer(frame) {
    let offer;
    try {
      offer = decodeJSON(frame.payload);
    } catch (e) {
      this.peer.core.emit('error', new PeerlinkError('PROTOCOL', 'Invalid file offer payload'));
      return;
    }

    const channelId = frame.channelId;
    const recvTx = new Emitter();
    let fileController = null;
    let received = 0;
    const safeName = (offer.name || 'file').replace(/^.*[\\\/]/, '').replace(/\.\./g, '');
    const env = this.peer.core.opts.env;
    let hashCtx = null;
    let fullChunks = [];

    const incoming = {
      stream: new ReadableStream({
        start(c) { fileController = c; },
        pull: () => {
          this.peer.flow.sendCredits(channelId, this.peer.core.opts.chunkSize * 4);
        },
        cancel: (reason) => {
          this.peer.sendRaw(TYPES.ABORT, 0, channelId, 0, encodeJSON({ reason: String(reason || 'canceled') }));
        }
      }),
      blob: async () => {
        const chunks = [];
        const reader = incoming.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        return new Blob(chunks, { type: offer.mime });
      },
      saveTo: async (destPath) => {
        const fs = this.peer.core.opts.fsAdapter;
        if (!fs || !fs.createWriteStream) throw new Error('saveTo only supported in Node');
        const writable = fs.createWriteStream(destPath);
        await incoming.stream.pipeTo(writable);
      },
      cancel: (reason = 'canceled') => {
        this.peer.sendRaw(TYPES.ABORT, 0, channelId, 0, encodeJSON({ reason }));
        if (fileController) {
          try { fileController.error(new PeerlinkError('ABORTED', reason)); } catch (e) {}
        }
      },
      on: recvTx.on.bind(recvTx)
    };

    const offerObj = {
      ...offer,
      name: safeName,
      id: channelId,
      accept: async (dest) => {
        if (offer.hash) {
          if (this.peer.core.opts.cryptoAdapter?.createHash) {
            hashCtx = this.peer.core.opts.cryptoAdapter.createHash('sha256');
          }
        }

        this.transfers.set(channelId, {
          data: (payload) => {
            if (fileController) {
              fileController.enqueue(payload);
            }
            received += payload.length;
            recvTx.emit('progress', { received, total: offer.size });
            
            // CORREÇÃO: Devolve os créditos de fluxo imediatamente após receber os dados.
            // Isso garante que o remetente nunca trave esperando a fila do stream esvaziar.
            this.peer.flow.sendCredits(channelId, payload.length);

            if (hashCtx) hashCtx.update(payload);
            else if (offer.hash && env === 'browser') fullChunks.push(payload);
          },
          end: async (payload) => {
            let meta = {};
            try { meta = decodeJSON(payload); } catch (e) {}

            if (offer.hash && meta.sha256) {
              let computed = hashCtx ? hashCtx.digest('hex') : null;
              if (!computed && env === 'browser' && fullChunks.length > 0) {
                computed = await this.peer.core.opts.cryptoAdapter.sha256(concatUint8(fullChunks));
              }
              if (computed && computed !== meta.sha256) {
                const err = new PeerlinkError('HASH_MISMATCH', `Hash mismatch: expected ${meta.sha256}, got ${computed}`);
                if (fileController) fileController.error(err);
                recvTx.emit('error', err);
                this.transfers.delete(channelId);
                return;
              }
            }

            if (fileController) fileController.close();
            recvTx.emit('done');
            this.transfers.delete(channelId);
          },
          abort: (reason) => {
            const err = new PeerlinkError('ABORTED', reason || 'Transfer aborted');
            if (fileController) {
              try { fileController.error(err); } catch (e) {}
            }
            recvTx.emit('error', err);
            this.transfers.delete(channelId);
          }
        });

        this.peer.sendRaw(TYPES.FILE_ACCEPT, 0, channelId, 0);

        if (dest && typeof dest === 'string' && env === 'node') {
          await incoming.saveTo(dest);
        }

        return incoming;
      },
      reject: (reason = 'REJECTED') => {
        this.peer.sendRaw(TYPES.FILE_REJECT, 0, channelId, 0, encodeJSON({ reason }));
      }
    };

    const listeners = this.peer.core.events.get('file');
    if (listeners && listeners.length > 0) {
      this.peer.core.emit('file', this.peer, offerObj);
    } else {
      offerObj.reject('No handler registered for file offers');
    }
  }

  handleControl(type, frame) {
    const tx = this.transfers.get(frame.channelId);
    if (!tx) return;
    if (type === TYPES.FILE_ACCEPT && tx.accept) tx.accept();
    else if (type === TYPES.FILE_REJECT && tx.reject) {
      let reason = 'REJECTED';
      try { reason = decodeJSON(frame.payload).reason || 'REJECTED'; } catch (e) {}
      tx.reject(reason);
    } else if (type === TYPES.FILE_DATA && tx.data) tx.data(frame.payload);
    else if (type === TYPES.FILE_END && tx.end) tx.end(frame.payload);
    else if (type === TYPES.ABORT && tx.abort) {
      let reason = 'ABORTED';
      try { reason = decodeJSON(frame.payload).reason || 'ABORTED'; } catch (e) {}
      tx.abort(reason);
    }
  }

  destroy() {
    for (const [channelId, tx] of this.transfers.entries()) {
      if (tx.abort) tx.abort('Peer closed');
    }
    this.transfers.clear();
  }
}

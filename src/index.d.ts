/// <reference types="node" />

export interface PeerlinkOptions {
  identifier: string;
  trackers?: string[];
  rtcConfig?: RTCConfiguration;
  chunkSize?: number;
  messageTimeout?: number;
  fileOptions?: { verifyHash?: boolean };
}

export class PeerlinkError extends Error {
  code: 'TRACKER_FAILED' | 'PEER_CLOSED' | 'TIMEOUT' | 'REJECTED' | 'HASH_MISMATCH' | 'ABORTED' | 'PROTOCOL' | 'WRTC_MISSING';
  constructor(code: string, message?: string);
}

export interface PeerHandle {
  id: string;
  close(): void;
  latency: number;
  respond(msg: any, opts?: { awaitReply?: boolean }): Promise<[PeerHandle, any]>;
}

export interface MessageData {
  id: number;
  data: string | any | Uint8Array;
  reply(payload: any, opts?: { awaitReply?: boolean }): Promise<[PeerHandle, any]>;
}

export interface FileOffer {
  id: number;
  name: string;
  size: number;
  mime: string;
  hash: boolean;
  accept(dest?: string | any): Promise<IncomingFile>;
  reject(reason?: string): void;
}

export interface IncomingFile {
  stream: ReadableStream<Uint8Array>;
  blob(): Promise<Blob>;
  saveTo(path: string): Promise<void>;
  cancel(reason?: string): void;
  on(event: 'progress' | 'done' | 'error', listener: Function): void;
}

export interface FileTransfer {
  id: number;
  promise: Promise<void>;
  cancel(reason?: string): void;
  on(event: 'progress' | 'accepted' | 'rejected' | 'done' | 'error', listener: Function): void;
}

export function toNodeReadable(webStream: ReadableStream<Uint8Array>): import('node:stream').Readable;
export function fromNodeReadable(nodeStream: import('node:stream').Readable): ReadableStream<Uint8Array>;

export default class Peerlink {
  constructor(options: PeerlinkOptions);
  id: string;
  peers: Map<string, PeerHandle>;
  start(): Promise<void>;
  destroy(): void;
  setIdentifier(id: string): void;
  requestMorePeers(): Promise<Map<string, PeerHandle>>;
  
  send(peer: PeerHandle, msg: any, opts?: { awaitReply?: boolean }): Promise<[PeerHandle, any]>;
  sendFile(peer: PeerHandle, source: any, opts?: { name?: string, mime?: string, size?: number, hash?: boolean, signal?: AbortSignal }): FileTransfer;
  createStream(peer: PeerHandle, meta?: any): Promise<WritableStream<Uint8Array>>;
  
  on(event: 'trackerconnect' | 'trackerwarning', listener: (trackerUrl: string) => void): this;
  on(event: 'peerconnect' | 'peerclose', listener: (peer: PeerHandle) => void): this;
  on(event: 'msg', listener: (peer: PeerHandle, msg: MessageData) => void): this;
  on(event: 'file', listener: (peer: PeerHandle, offer: FileOffer) => void): this;
  on(event: 'stream', listener: (peer: PeerHandle, stream: ReadableStream<Uint8Array>, meta: any) => void): this;
  on(event: 'error', listener: (err: PeerlinkError) => void): this;
}
}
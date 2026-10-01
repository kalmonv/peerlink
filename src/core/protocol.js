export const TYPES = {
  MSG: 0x01, MSG_REPLY: 0x02,
  FILE_OFFER: 0x10, FILE_ACCEPT: 0x11, FILE_REJECT: 0x12, FILE_DATA: 0x13, FILE_END: 0x14,
  STREAM_OPEN: 0x20, STREAM_DATA: 0x21, STREAM_END: 0x22,
  CREDIT: 0x30, ABORT: 0x3F, MEDIA_INFO: 0x40, RENEGOTIATE: 0x50, HELLO: 0x99 // <-- RENEGOTIATE adicionado
};

export const FLAGS = { NONE: 0, FIN: 1 };
export const HEADER_SIZE = 9;

export function encodeFrame(type, flags, channelId, seq, payload) {
  const buf = new Uint8Array(HEADER_SIZE + (payload ? payload.length : 0));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint8(0, type);
  view.setUint8(1, flags);
  view.setUint32(2, channelId, false);
  view.setUint8(6, (seq >> 16) & 0xff);
  view.setUint8(7, (seq >> 8) & 0xff);
  view.setUint8(8, seq & 0xff);
  if (payload) buf.set(payload, HEADER_SIZE);
  return buf;
}

export function decodeFrame(buf) {
  if (buf.length < HEADER_SIZE) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const type = view.getUint8(0);
  const flags = view.getUint8(1);
  const channelId = view.getUint32(2, false);
  const seq = (view.getUint8(6) << 16) | (view.getUint8(7) << 8) | view.getUint8(8);
  const payload = buf.subarray(HEADER_SIZE);
  return { type, flags, channelId, seq, payload };
}
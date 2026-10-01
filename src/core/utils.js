export const getEnv = () => typeof window !== 'undefined' ? 'browser' : 'node';

export const randomHex = (bytes = 20) => {
  const arr = new Uint8Array(bytes);
  if (getEnv() === 'browser') crypto.getRandomValues(arr);
  else globalThis.crypto?.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
};

export const hexToUint8 = (hex) => {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
};

export const concatUint8 = (arrays) => {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { out.set(arr, offset); offset += arr.length; }
  return out;
};

export const encodeJSON = (obj) => new TextEncoder().encode(JSON.stringify(obj));
export const decodeJSON = (buf) => JSON.parse(new TextDecoder().decode(buf));
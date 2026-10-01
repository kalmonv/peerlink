export class PeerlinkError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'PeerlinkError';
    this.code = code;
  }
}


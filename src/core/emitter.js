export default class Emitter {
  constructor() { this.events = new Map(); }
  on(evt, cb) {
    if (!this.events.has(evt)) this.events.set(evt, []);
    this.events.get(evt).push(cb);
    return this;
  }
  once(evt, cb) {
    const fn = (...args) => { this.off(evt, fn); cb(...args); };
    return this.on(evt, fn);
  }
  off(evt, cb) {
    const evts = this.events.get(evt);
    if (evts) this.events.set(evt, evts.filter(f => f !== cb));
    return this;
  }
  emit(evt, ...args) {
    const evts = this.events.get(evt);
    if (evts) evts.slice().forEach(cb => cb(...args));
  }
  removeAllListeners() { this.events.clear(); }
}
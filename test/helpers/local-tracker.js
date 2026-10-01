import { Server } from 'bittorrent-tracker';

export function startLocalTracker(port = 8000) {
  return new Promise((resolve) => {
    const server = new Server({ http: false, udp: false, ws: true });
    server.listen(port, () => resolve(server));
  });
}
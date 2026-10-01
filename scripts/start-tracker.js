import { Server } from 'bittorrent-tracker';

const server = new Server({ http: false, udp: false, ws: true });
server.listen(8000, () => {
  console.log('Local tracker running at ws://localhost:8000');
});
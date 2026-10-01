import Peerlink from '../src/node.js';
import { writeFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';

// Cria arquivo de 5MB se não existir
if (!existsSync('./dummy.bin')) {
  writeFileSync('./dummy.bin', crypto.randomBytes(5 * 1024 * 1024));
}

const p = new Peerlink({
  identifier: 'demo-local',
  trackers: ['ws://localhost:8000'],
  rtcConfig: { iceServers: [] }
});

p.start().then(() => console.log('Aguardando peer...')).catch(console.error);

p.on('peerconnect', peer => {
  console.log('Peer conectado. Enviando file...');
  const tx = p.sendFile(peer, './dummy.bin', { name: 'dummy.bin', hash: true });
  tx.on('progress', ({ sent, total, speed }) => {
    console.log(`Enviado: ${Math.round((sent / total) * 100)}% (${speed} B/s)`);
  });
  tx.on('done', () => {
    console.log('Transferência completa com sucesso!');
    setTimeout(() => {
      p.destroy();
      process.exit(0);
    }, 500);
  });
  tx.on('error', (err) => {
    console.error('Erro no envio:', err);
    p.destroy();
    process.exit(1);
  });
});
});
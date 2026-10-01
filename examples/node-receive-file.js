import Peerlink from '../src/node.js';

const p = new Peerlink({
  identifier: 'demo-local',
  trackers: ['ws://localhost:8000'],
  rtcConfig: { iceServers: [] }
});

p.start().then(() => console.log('Aguardando peer...')).catch(console.error);

p.on('file', async (peer, offer) => {
  console.log(`Recebendo ${offer.name} (${offer.size} bytes)`);
  const incoming = await offer.accept();
  
  incoming.on('progress', ({ received, total }) => {
    process.stdout.write(`\rProgresso: ${Math.round((received / total) * 100)}%`);
  });
  incoming.on('done', () => {
    console.log('\nFinalizado com Hash Válido!');
    setTimeout(() => {
      p.destroy();
      process.exit(0);
    }, 500);
  });
  incoming.on('error', (err) => {
    console.error('\nErro na recepção do arquivo:', err);
    p.destroy();
    process.exit(1);
  });
  
  await incoming.saveTo('./received.bin');
});
});
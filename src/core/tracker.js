import Client from 'bittorrent-tracker';

export function createTrackerClient(core, infoHashHex, peerIdHex) {
  const client = new Client({
    infoHash: infoHashHex,
    peerId: peerIdHex,
    announce: core.opts.trackers,
    wrtc: core.opts.wrtc,
    rtcConfig: core.opts.rtcConfig,
    port: 6881
  });

  client.on('error', err => {
    core.emit('trackerwarning', err);
    core.emit('error', err);
  });
  client.on('warning', err => core.emit('trackerwarning', err));

  client.on('update', data => {
    if (data && data.announce) {
      core.emit('trackerconnect', data.announce);
    }
  });
  
  client.on('peer', (webrtcPeer) => {
    if (webrtcPeer.id && core.peers.has(webrtcPeer.id)) {
      webrtcPeer.destroy();
      return;
    }
    new core.PeerHandle(core, webrtcPeer);
  });

  client.start();
  return client;
}

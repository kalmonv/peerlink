# Peerlink 🌐

Peerlink é uma biblioteca P2P (Peer-to-Peer) moderna e leve para Node.js e Browsers, construída sobre WebTorrent/WebRTC e canais de dados binários customizados. Ela permite comunicação em tempo real descentralizada, transferência de arquivos, streams de dados contínuos e transmissão de mídia de vídeo/áudio utilizando identificadores de sala baseados em WebTorrent trackers.

---

## 📋 Tabela de Conteúdos
- [Instalação](#-instalação)
- [Compatibilidade: Node.js vs Browser](#-compatibilidade-nodejs-vs-browser)
- [Guia de Início Rápido](#-guia-de-início-rápido)
- [Referência de Métodos e API](#-referência-de-métodos-e-api)
- [Exemplos de Uso](#-exemplos-de-uso)

---

## 📦 Instalação

```bash
npm install peerlink

```

---

## 🛠️ Compatibilidade: Node.js vs Browser

Nem todas as funcionalidades nativas do WebRTC ou do ambiente estão disponíveis em ambos os ambientes. O quadro abaixo detalha o suporte:

| Funcionalidade / Método | Node.js | Browser | Notas / Restrições |
| --- | --- | --- | --- |
| **Descoberta via Tracker (P2P)** | ✅ Sim | ✅ Sim | Conexão via WebSockets (`wss://`) ou UDP (dependendo do tracker). |
| **Chat / Mensagens binárias (`p.send`)** | ✅ Sim | ✅ Sim | Totalmente compatível via DataChannels. |
| **Transferência de Arquivos (`p.sendFile`)** | ✅ Sim | ✅ Sim | No Node.js usa caminhos de arquivos / streams; no Browser usa File/Blob. |
| **Streams de Texto/Dados (`p.createStream`)** | ✅ Sim | ✅ Sim | Streams legíveis/graváveis baseados em Streams API (Web Streams). |
| **Transmissão de Mídia (`p.sendMedia`)** | ❌ Não | ✅ Sim | Exige APIs de hardware do navegador (`getUserMedia` / `getDisplayMedia`). |

---

## 🚀 Guia de Início Rápido

### No Browser:

```javascript
import Peerlink from 'peerlink'; // ou caminho relativo para /src/browser.js

const p = new Peerlink({
  identifier: 'minha-sala-secreta',
  trackers: ['wss://tracker.openwebtorrent.com']
});

p.on('peerconnect', peer => {
  console.log('Conectado ao peer:', peer.id);
  p.send(peer, 'Olá via P2P!');
});

p.start();

```

---

## 📖 Referência de Métodos e API

### `new Peerlink(options)`

Cria uma nova instância principal da rede P2P.

* **`options.identifier`** *(String)*: Identificador único da sala/swarm (funciona como o hash do torrent).
* **`options.trackers`** *(Array)*: Lista de URLs de WebSockets de trackers P2P.

### Métodos da Instância (`Peerlink`)

* **`p.start()`**: Inicia a conexão com os trackers e a escuta por peers.
* **`p.send(peer, message)`** *(Universal)*: Envia uma mensagem de texto ou payload rápido para um peer conectado.
* **`p.sendFile(peer, file, options)`** *(Universal)*: Inicia o envio de um arquivo (`File`, `Blob` ou Stream do Node.js). Retorna um objeto de transação com eventos (`progress`, `done`, `rejected`, `error`).
* **`p.createStream(peer, meta)`** *(Universal)*: Cria um canal de stream bidirecional em tempo real. Retorna um `WritableStream`.
* **`p.sendMedia(peer, mediaStream, meta)`** *(Apenas Browser)*: Transmite uma stream de mídia nativa (câmera ou tela) para o peer remoto via renegociação WebRTC. Retorna um objeto de controle com a função `.stop()`.

### Eventos Principais do `Peerlink`

* **`p.on('trackerconnect', (url) => {})`**: Disparado ao conectar a um tracker.
* **`p.on('peerconnect', (peer) => {})`**: Disparado quando um novo peer se conecta com sucesso.
* **`p.on('peerclose', (peer) => {})`**: Disparado quando um peer se desconecta.
* **`p.on('msg', (peer, msg) => {})`**: Recebimento de mensagens de chat.
* **`p.on('file', (peer, offer) => {})`**: Recebimento de oferta de arquivo (`offer.accept()` / `offer.reject()`).
* **`p.on('stream', (peer, readable, meta) => {})`**: Recebimento de um stream contínuo de dados.
* **`p.on('media', (peer, stream, meta) => {})`** *(Apenas Browser)*: Recebimento de stream de áudio/vídeo de outro peer.

---

## 💡 Exemplos de Métodos em Ação

### 1. Envio de Chat

```javascript
// Enviar
await p.send(peer, 'Tudo bem?');

// Receber
p.on('msg', (peer, msg) => {
  console.log(`Mensagem de ${peer.id}: ${msg.data}`);
});

```

### 2. Envio e Recebimento de Arquivos

```javascript
// Enviar arquivo (Browser)
const fileInput = document.getElementById('filePicker').files[0];
const tx = p.sendFile(peer, fileInput, { hash: true });

tx.on('progress', ({ sent, total, speed }) => {
  console.log(`Progresso: ${Math.round((sent/total)*100)}% (${speed} B/s)`);
});

// Receber arquivo
p.on('file', async (peer, offer) => {
  if (confirm(`Aceitar arquivo ${offer.name}?`)) {
    const incoming = await offer.accept();
    incoming.on('done', async () => {
      const blob = await incoming.blob();
      // Fazer o download do blob no browser
    });
  } else {
    offer.reject();
  }
});

```

### 3. Transmissão de Mídia (Câmera ou Tela - Apenas Browser)

```javascript
// Compartilhar a própria webcam com o peer
const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
const mediaSession = p.sendMedia(peer, mediaStream, { type: 'Câmera' });

// Para interromper a transmissão a qualquer momento:
// mediaSession.stop();

// Receber mídia de outro peer
p.on('media', (peer, stream, meta) => {
  const videoElement = document.createElement('video');
  videoElement.srcObject = stream;
  videoElement.autoplay = true;
  document.body.appendChild(videoElement);
});

```

---

## 📄 Licença

MIT
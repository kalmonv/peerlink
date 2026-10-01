
# TAREFA

Você é um engenheiro sênior de JavaScript. Crie do zero uma biblioteca open source chamada **peerlink** (MVP), inspirada na biblioteca P2PT (github.com/subins2000/p2pt). Ela deve funcionar **no browser e no Node.js** com a mesma API pública.

Entregue o projeto completo: todos os arquivos, código funcional, testes e README. Não use pseudocódigo nem "TODO". Antes de codar, apresente a árvore de arquivos e um resumo curto do protocolo. Depois entregue o código arquivo por arquivo.

## 1. Conceito

- Usa trackers WebTorrent públicos (WebSocket) como servidor de sinalização WebRTC.
- Uma string identificadora do app vira um info hash de 20 bytes (SHA-1 da string, em hex de 40 caracteres). Peers que anunciam o mesmo hash se descobrem e abrem conexões WebRTC diretas (RTCDataChannel).
- Depois do handshake, todo o tráfego (mensagens, arquivos, streams) vai direto entre os peers, sem passar pelo tracker.

## 2. Requisitos técnicos

- JavaScript ESM (`"type": "module"`), Node >= 18, com tipos em `.d.ts` escritos à mão (sem TypeScript no build).
- Dependências de runtime: `bittorrent-tracker` (cliente de tracker; expõe peers WebRTC via evento `peer`) e `uint8-util`.
- Dependência opcional no Node: `@roamhq/wrtc`, carregada com `import()` dinâmico apenas no Node. Se faltar, lance um erro claro explicando como instalar.
- Dev: `vite` (build e dev server) e `vitest` ou `node:test`.
- Verifique a documentação atual do `bittorrent-tracker` (opções `infoHash`, `peerId`, `announce`, `wrtc`, `rtcConfig`, evento `peer`) e use o que ela documenta. Não invente APIs.
- Campo `exports` condicional no package.json:
    - `browser` → `./src/browser.js`
    - `node` → `./src/node.js`
    - `types` → `./src/index.d.ts`
    - Builds em `./dist`: ESM, CJS e IIFE/UMD para uso via `<script>`.
- Núcleo isomórfico: todo código comum fica em `src/core/`. Os arquivos `browser.js` e `node.js` só injetam diferenças de plataforma (implementação de WebRTC, crypto, fs).
- Use apenas APIs padrão disponíveis nos dois ambientes: `Uint8Array`, `TextEncoder`, `ReadableStream`/`WritableStream` (Web Streams), `AbortController`, `crypto.subtle` (no Node, use `globalThis.crypto` ou `node:crypto`.webcrypto).
- Nada de `Buffer` no core. Use `Uint8Array`.

## 3. Estrutura de arquivos

```
peerlink/
├── package.json
├── README.md
├── vite.config.js
├── src/
│   ├── browser.js            # entry browser: injeta RTC nativo
│   ├── node.js               # entry Node: injeta @roamhq/wrtc + helpers de fs
│   ├── index.d.ts            # tipos públicos
│   └── core/
│       ├── Peerlink.js       # classe principal (EventEmitter)
│       ├── PeerHandle.js     # wrapper de um peer conectado
│       ├── tracker.js        # ciclo de vida do cliente bittorrent-tracker
│       ├── protocol.js       # codec binário de frames
│       ├── messaging.js      # send/respond com Promise + chunking
│       ├── files.js          # envio/recebimento de arquivos
│       ├── streams.js        # streaming com backpressure
│       ├── flow.js           # janela de créditos / bufferedAmount
│       ├── emitter.js        # EventEmitter mínimo isomórfico
│       └── utils.js          # hex, sha1, sha256, ids, timeouts
├── test/
│   ├── helpers/local-tracker.js   # sobe tracker WS local (bittorrent-tracker Server)
│   ├── messaging.test.js
│   ├── files.test.js
│   └── streams.test.js
├── examples/
│   ├── node-send-file.js
│   ├── node-receive-file.js
│   └── browser/index.html    # chat + enviar arquivo + demo de stream
└── scripts/start-tracker.js
```

## 4. API pública

Mantenha compatibilidade conceitual com o P2PT e adicione arquivos e streams.

```js
import Peerlink from 'peerlink'

const p = new Peerlink({
  trackers: ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev'],
  identifier: 'meu-app',
  rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }, // opcional
  chunkSize: 16 * 1024,        // bytes por frame de dados
  messageTimeout: 30000,
  fileOptions: { verifyHash: true }
})
```

### 4.1 Ciclo de vida e descoberta

- `start()`: conecta aos trackers e começa a anunciar.
- `destroy()`: fecha peers, trackers e streams em andamento, sem vazar listeners nem timers.
- `setIdentifier(str)`, `requestMorePeers(): Promise<Map|Object>`.
- `peers`: Map dos peers conectados (`peer.id` → PeerHandle).
- `id`: peerId local (20 bytes aleatórios, em hex).
- Eventos: `trackerconnect`, `trackerwarning`, `peerconnect`, `peerclose`, `error`.

### 4.2 Mensagens (paridade com o P2PT)

- `send(peer, msg): Promise<[peer, reply]>`. `msg` pode ser string, objeto JSON-serializável ou `Uint8Array`. A Promise resolve quando o peer responder com `peer.respond(...)`. Se não houver resposta, rejeite por timeout somente se `{ awaitReply: true }` for passado. O padrão é resolver quando a mensagem for entregue.
- `peer.respond(msg): Promise<[peer, reply]>`, para conversas encadeadas.
- Eventos: `data` (cada chunk bruto, para depuração) e `msg` (`(peer, msg)`, quando a mensagem está completa). O `msg` recebido deve ter `msg.id` e um `msg.reply(payload)`.
- Mensagens maiores que `chunkSize` são fragmentadas e remontadas automaticamente.

### 4.3 Arquivos (NOVO)

- `sendFile(peer, source, opts?): FileTransfer`
    - `source` no browser: `File` ou `Blob`.
    - `source` no Node: caminho (string), `Buffer`/`Uint8Array` ou `stream.Readable`.
    - `opts`: `{ name, mime, size, hash: true, signal: AbortSignal }`.
    - O retorno é um objeto `FileTransfer` com `id`, `promise` (resolve ao terminar ou rejeita), `cancel()` e eventos `progress` (`{ sent, total, speed }`), `accepted`, `rejected`, `done`, `error`.
- Fluxo: **oferta → aceite/rejeição → dados → fim + hash**. O remetente só começa a enviar após o receptor aceitar.
- Receptor:
    - `p.on('file', (peer, offer) => ...)`, onde `offer = { id, name, size, mime, accept(dest?), reject(reason?) }`.
    - `accept()` devolve um `IncomingFile` com `stream` (ReadableStream dos bytes), `blob()` (browser: junta tudo em um Blob), `saveTo(path)` (Node: grava em disco com `stream.pipeline`, sem carregar tudo na memória), eventos `progress`, `done`, `error` e `cancel()`.
    - Sem handler registrado para `file`, rejeite automaticamente a oferta.
- Integridade: se `verifyHash`, o remetente calcula SHA-256 incrementalmente (ou envia no frame END) e o receptor valida. Em caso de divergência, emita `error` com código `HASH_MISMATCH`.
- Arquivos grandes (GBs) nunca devem ser carregados inteiros na memória. Leia em fatias (`Blob.slice` / `fs.createReadStream`).

### 4.4 Streaming (NOVO)

- `createStream(peer, meta?): Promise<PeerWritable>`
    - Retorna um `WritableStream` (API Web Streams) com backpressure real: `writer.write(chunk)` só resolve quando há espaço na janela de envio.
    - `meta`: objeto JSON livre (ex.: `{ type: 'audio/webm', label: 'mic' }`).
    - `close()` envia END. `abort(reason)` envia ABORT.
- Receptor: `p.on('stream', (peer, readable, meta) => ...)`, onde `readable` é um `ReadableStream<Uint8Array>`. A tela só recebe dados se consumir o stream (backpressure propagado até o remetente).
- Helpers só no Node: `toNodeReadable(readable)` / `fromNodeReadable(nodeStream)` (via `Readable.fromWeb`/`toWeb`).
- Suporte a vários streams simultâneos por peer (multiplexação por `streamId`), cada um com sua própria janela.
- Use cases a demonstrar: stream de `MediaRecorder` no browser, stream de arquivo de log no Node, pipe `fs → peer → fs`.

### 4.5 Erros

Classe `PeerlinkError` com `code`: `TRACKER_FAILED`, `PEER_CLOSED`, `TIMEOUT`, `REJECTED`, `HASH_MISMATCH`, `ABORTED`, `PROTOCOL`, `WRTC_MISSING`.

## 5. Protocolo binário (implementar em `protocol.js`)

Todo frame trafega como `Uint8Array` no DataChannel (`binaryType = 'arraybuffer'`).

Cabeçalho (9 bytes, big-endian):

```
[0]    u8   type
[1]    u8   flags  (bit0 = FIN / último chunk)
[2-5]  u32  channelId   (id de mensagem, arquivo ou stream)
[6-8]  u24  seq         (contador de chunk dentro do canal)
[9..]  payload
```

Tipos:

- `0x01 MSG`: chunk de mensagem (payload = bytes; o primeiro chunk começa com 1 byte de subtipo: 0=string UTF-8, 1=JSON, 2=binário).
- `0x02 MSG_REPLY`: igual a MSG, com `replyTo` (u32) logo após o cabeçalho.
- `0x10 FILE_OFFER`: payload JSON `{name,size,mime,hash?}`.
- `0x11 FILE_ACCEPT` / `0x12 FILE_REJECT`: payload JSON opcional `{reason}`.
- `0x13 FILE_DATA`: bytes do arquivo.
- `0x14 FILE_END`: payload JSON `{sha256?}`.
- `0x20 STREAM_OPEN`: payload JSON (meta).
- `0x21 STREAM_DATA`, `0x22 STREAM_END`.
- `0x30 CREDIT`: payload u32 com quantos bytes (ou chunks) o receptor liberou.
- `0x3F ABORT`: payload JSON `{reason}` (vale para qualquer canal).

Regras:

- `chunkSize` padrão 16 KiB (máximo interoperável entre browsers e Node). Permita configurar, mas valide o limite.
- Frames inválidos ou de tipo desconhecido: ignore e emita `error` com `PROTOCOL`. Nunca lance exceção não tratada.
- Nunca use `eval` nem `Function`. Limite de tamanho no JSON de metadados (ex.: 64 KiB) para evitar abuso.

## 6. Controle de fluxo (backpressure) — `flow.js`

- Duas camadas:
    1. **Camada local**: antes de enviar, verifique `dataChannel.bufferedAmount`. Acima do high watermark (ex.: 1 MiB), pause a escrita até o evento `bufferedamountlow` (configure `bufferedAmountLowThreshold` ≈ 256 KiB).
    2. **Camada fim a fim**: janela de créditos. O remetente só envia enquanto `bytesEmVoo < janela` (padrão 512 KiB por canal). O receptor devolve `CREDIT` conforme o consumidor do ReadableStream lê os dados.
- Garanta que um consumidor lento no receptor faça o remetente pausar, sem crescimento ilimitado de memória. Inclua um teste para isso.
- O fechamento do peer ou do canal deve rejeitar todas as Promises pendentes com `PEER_CLOSED` e liberar buffers.

## 7. Comportamento de rede

- Ao receber o evento `peer` do `bittorrent-tracker`, envolva o peer em `PeerHandle` e só emita `peerconnect` quando o DataChannel estiver aberto (`connect`).
- Deduplique peers (mesmo peerId conectado via vários trackers). Evite auto-conexão.
- Reconexão ao tracker com backoff exponencial simples. Emita `trackerwarning` em falhas.
- Não persista nem logue dados sensíveis. Logs só sob `DEBUG=peerlink:*` (Node) ou `localStorage.debug` (browser), protegido com try/catch.

## 8. Segurança (mínimo para o MVP)

- O canal WebRTC já é cifrado (DTLS). Documente no README o limite: **a identidade do peer não é autenticada**. Quem conhece o identificador pode entrar, e um tracker malicioso poderia tentar MITM na sinalização.
- Mitigação opcional e simples: opção `secret` que deriva o info hash e um HMAC de handshake a partir de um segredo compartilhado (`HMAC-SHA256`) e rejeita peers que não provarem o segredo. Implemente de forma mínima ou documente como trabalho futuro, mas decida e diga qual dos dois.
- Valide tamanhos declarados nas ofertas e permita `maxFileSize` no receptor. Sanitize `offer.name` (sem `/`, `\`, `..`) antes de `saveTo`.

## 9. Testes (obrigatórios)

- Suba um tracker local com `bittorrent-tracker` (Server com `ws: true`) no helper de teste. Não dependa de trackers públicos.
- Teste dois peers Peerlink no mesmo processo Node, usando `@roamhq/wrtc`:
    - descoberta e `peerconnect` nos dois lados;
    - mensagem curta, mensagem de 5 MB (chunking), resposta encadeada com `respond`;
    - arquivo de 50 MB com verificação de hash, cancelamento no meio, rejeição pelo receptor;
    - stream com consumidor lento (valida backpressure) e múltiplos streams simultâneos;
    - `destroy()` no meio de uma transferência rejeita as Promises e não deixa handles abertos.
- Inclua uma página `test/browser.html` para rodar o mesmo cenário básico no browser (dois tabs ou duas instâncias).
- Scripts do package.json: `dev`, `build`, `test`, `tracker`.

## 10. README (em português e inglês)

Inclua: o que é, como funciona, instalação (browser e Node), quick start de mensagem, arquivo e stream, tabela da API, limitações (NAT simétrico exige TURN, trackers públicos podem cair, sem autenticação de peers), e como configurar STUN/TURN.

## 11. Critérios de aceite

- `npm install && npm test` passa localmente, sem rede externa.
- `examples/node-send-file.js` e `examples/node-receive-file.js` transferem um arquivo entre dois processos.
- `examples/browser/index.html` (servido pelo Vite) permite abrir duas abas, conversar, enviar um arquivo com barra de progresso e ver um stream de texto ao vivo.
- Nenhum uso de `Buffer` ou de módulos do Node nos arquivos de `src/core/`.
- Todas as APIs acima com tipagem em `index.d.ts`.

## 12. Fora do escopo do MVP

Salas com permissões, criptografia própria além do DTLS, retomada de transferências interrompidas, transferência multi-peer estilo torrent, UI elaborada.

Responda primeiro com a árvore de arquivos e o desenho do protocolo (máx. 40 linhas), depois gere todos os arquivos completos.

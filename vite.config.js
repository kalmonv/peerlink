import { defineConfig } from 'vite';
import { resolve } from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    // Esse plugin injeta o EventEmitter, Buffer, process e outros módulos nativos do Node no Browser
    nodePolyfills({
      include: ['events', 'buffer', 'stream', 'util', 'process'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: {
        browser: resolve(__dirname, 'src/browser.js'),
        node: resolve(__dirname, 'src/node.js')
      },
      name: 'Peerlink',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      // Deixamos essas libs externas apenas para o build do Node.
      external: ['node:fs', 'node:crypto', 'node:stream', 'node:stream/web', '@roamhq/wrtc'],
      output: {
        // Define o nome fixo baseado na chave de entrada (browser.js / node.js) e formato
        entryFileNames: (chunkInfo) => {
          return `[name].js`; // Vai gerar exatamente browser.js e node.js (ou adicione suffixo se necessário, ex: [name].[format].js)
        },
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
});
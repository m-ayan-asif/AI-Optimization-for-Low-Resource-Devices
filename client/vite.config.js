import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

// ONNX Runtime's WebAssembly binaries are served from our own origin (/ort/) so on-device inference works offline
// and never calls a CDN. Copied from node_modules at dev-server start and at build time (not committed).
function copyOrtWasm() {
  const src = path.resolve('node_modules/onnxruntime-web/dist');
  const copyTo = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      if (/^ort-wasm.*\.(wasm|mjs)$/.test(f)) fs.copyFileSync(path.join(src, f), path.join(dir, f));
    }
  };
  return {
    name: 'copy-ort-wasm',
    // Copy before the dev server scans public/ (configureServer runs too late: on a fresh clone the files are not
    // served until the next restart and /ort/* falls through to index.html).
    config() {
      copyTo(path.resolve('public/ort'));
    },
    configureServer(server) {
      // onnxruntime-web import()s its module from /ort/. In dev Vite appends ?import to such imports and then answers
      // 500 ("file is in /public ... should not be imported from source code"). Strip it so the file is served as is.
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/ort/')) req.url = req.url.replace(/\?import$/, '');
        next();
      });
    },
    writeBundle(options) {
      copyTo(path.join(options.dir || 'dist', 'ort'));
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    copyOrtWasm(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'SkinSense',
        short_name: 'SkinSense',
        description: 'Skin condition screening that works offline on your phone.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#300060',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. The models (~350 MB) are cached by the app itself on first use (ondevice/modelCache.js for
        // the skin model, transformers.js's browser cache for Whisper), so the worker caches just the ORT binaries -
        // caching /models/ here too would store Whisper twice on the phone.
        // ORT's WebAssembly runtime is precached: every on-device screening needs it, offline included.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}', 'ort/ort-wasm-simd-threaded.{mjs,wasm}'],
        globIgnores: ['models/**', 'assets/*.wasm'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/heatmaps\//, /^\/models\//, /^\/ort\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ort/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'skinsense-ort',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 40 },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
});

// Serves the production build of client/ for the e2e tests on http://localhost:4173. http://localhost is a secure
// context, so the service worker (offline mode) registers - unlike Caddy's self-signed https://localhost.
// /api is proxied to the running stack (start.cmd or deploy/: docker compose up), as Caddy does in production.
import base from '../client/vite.config.js';

const API = process.env.E2E_API_URL || 'https://localhost';

export default {
  ...base,
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': { target: API, secure: false, changeOrigin: true } },
    // Same isolation headers as deploy/Caddyfile, so ONNX Runtime gets multi-threaded WebAssembly as in production.
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
  },
};

import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Motion and orientation APIs only work in secure contexts, so phones on the
  // LAN need HTTPS even in development; a self-signed certificate is enough.
  plugins: [basicSsl()],
  server: {
    // Exposes the LAN address so phones on the same Wi-Fi can open the dev server.
    host: true,
    port: 5173,
    strictPort: true,
    // Phones reach the room server through the Vite HTTPS origin, so the page and
    // socket stay same-origin (wss) without a second certificate. Run
    // `npm run dev:server` alongside `npm run dev`.
    proxy: {
      '/ws': {
        // Must match DEFAULT_PORT in server/config.ts.
        target: 'http://localhost:3000',
        ws: true,
        // Keep the phone's Host header: the dev-mode origin check compares the
        // Origin host with Host, and rewriting it to localhost would fail that.
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});

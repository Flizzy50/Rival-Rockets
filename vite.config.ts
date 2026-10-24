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

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { DEFAULT_PORT, HOST, SHUTDOWN_TIMEOUT_MS } from './config.js';

// Resolved from the compiled file (dist-server/server/main.js) so the working directory does not matter.
const distDir = fileURLToPath(new URL('../../dist', import.meta.url));
const port = Number(process.env.PORT) || DEFAULT_PORT;

const server = http.createServer(createApp(distDir));

// M2: attach the ws WebSocketServer to this same http server so WSS shares
// the page's origin, certificate, and port.

server.listen(port, HOST, () => {
  console.log(`Rival Rockets listening on http://localhost:${port}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, closing server`);
  server.close(() => process.exit(0));
  // Keep-alive connections can hold close() open; never block a redeploy on them.
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

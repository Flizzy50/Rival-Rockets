import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { DEFAULT_PORT, HOST, SHUTDOWN_TIMEOUT_MS, trustedProxyHops } from './config.js';
import { buildAllowedOrigins } from './origin.js';
import { controlTestFlag } from './simulation.js';
import { attachGateway } from './websocket.js';

// Resolved from the compiled file (dist-server/server/main.js) so the working directory does not matter.
const distDir = fileURLToPath(new URL('../../dist', import.meta.url));
const port = Number(process.env.PORT) || DEFAULT_PORT;
const devMode = process.argv.includes('--dev');
const allowedOrigins = buildAllowedOrigins(process.env);
const controlTestEnabled = controlTestFlag(process.argv, process.env);

const server = http.createServer(createApp(distDir, allowedOrigins));

// Same http server, so WSS shares the page's origin, certificate, and port.
const gateway = attachGateway(server, {
  allowedOrigins,
  devMode,
  controlTestEnabled,
  trustedProxyHops: trustedProxyHops(process.env),
});

server.listen(port, HOST, () => {
  console.log(`Rival Rockets listening on http://localhost:${port}`);
  console.log(`dev mode ${devMode ? 'on' : 'off'}, control test ${controlTestEnabled ? 'on' : 'off'}, ${allowedOrigins.size} allowed origin(s)`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, closing server (${gateway.connectionCount()} socket(s))`);
  // Rooms live only in memory, so phones are told before they vanish (PRD 8).
  gateway.close('server-closing');
  server.close(() => process.exit(0));
  // Keep-alive connections can hold close() open; never block a redeploy on them.
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

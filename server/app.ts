import path from 'node:path';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { ASSET_MAX_AGE_S, HSTS_MAX_AGE_S } from './config.js';

// 'self' does not cover ws:/wss: in every browser (Safari has refused
// same-host wss: under it), so each allowed origin is listed in its WebSocket
// form as well (design M2-8).
export function contentSecurityPolicy(allowedOrigins: ReadonlySet<string>): string {
  const sockets = [...allowedOrigins].map((origin) => origin.replace(/^http/, 'ws'));
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    ["connect-src 'self'", ...sockets].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
}

// Motion sensors and wake lock are the only powerful features the game uses (PRD 10).
const PERMISSIONS_POLICY =
  'accelerometer=(self), gyroscope=(self), screen-wake-lock=(self), camera=(), microphone=(), geolocation=()';

function securityHeaders(csp: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE_S}`);
    next();
  };
}

export function createApp(distDir: string, allowedOrigins: ReadonlySet<string> = new Set()): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders(contentSecurityPolicy(allowedOrigins)));

  app.get('/healthz', (_req, res) => {
    res.set('Cache-Control', 'no-store').type('text/plain').send('ok');
  });

  const assetsDir = path.join(distDir, 'assets') + path.sep;
  app.use(
    express.static(distDir, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (filePath.startsWith(assetsDir)) {
          res.setHeader('Cache-Control', `public, max-age=${ASSET_MAX_AGE_S}, immutable`);
        } else if (filePath.endsWith('.html')) {
          // HTML names are not fingerprinted, so it must revalidate to pick up new builds.
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  return app;
}

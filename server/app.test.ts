import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentSecurityPolicy, createApp } from './app.js';

let fixtureDir: string;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'rival-rockets-dist-'));
  await mkdir(path.join(fixtureDir, 'assets'));
  await writeFile(path.join(fixtureDir, 'index.html'), '<!doctype html><title>t</title>');
  await writeFile(path.join(fixtureDir, 'assets', 'app.js'), 'export {};');

  server = http.createServer(createApp(fixtureDir));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await rm(fixtureDir, { recursive: true, force: true });
});

describe('static server', () => {
  it('answers the health check without caching', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
  });

  it('sends security headers and hides the framework', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('permissions-policy')).toContain('accelerometer=(self)');
    expect(res.headers.get('permissions-policy')).toContain('geolocation=()');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('serves index.html at / with revalidation', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves fingerprinted assets as immutable JavaScript', async () => {
    const res = await fetch(`${baseUrl}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('lists the wss form of each allowed origin in connect-src (design M2-8)', () => {
    const csp = contentSecurityPolicy(new Set(['https://rr.onrender.com', 'http://localhost:3000']));
    expect(csp).toContain("connect-src 'self' wss://rr.onrender.com ws://localhost:3000;");
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/missing`);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

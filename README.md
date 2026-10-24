# Rival Rockets

Browser party game for four phones. This build is the Milestone 1 sensor test only: it checks motion permission, calibration, pilot tilt, and engineer shake on real phones. There are no rooms or matches yet. The product spec is [rival-rockets-prd.md](rival-rockets-prd.md).

## Requirements

- Node.js 24.22.1 (see `.node-version`)
- npm

## Install

```sh
npm ci
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server over HTTPS on port 5173, reachable from the LAN |
| `npm run typecheck` | Type-checks client, shared, and server code |
| `npm run lint` | ESLint |
| `npm test` | Vitest, single run |
| `npm run build` | Typecheck, build the client to `dist/`, compile the server to `dist-server/` |
| `npm start` | Runs the production server from `dist-server/` (port 3000 or `$PORT`) |
| `npm run check` | Lint, test, and build |

## Test on your phone (HTTPS on your LAN)

Phone browsers only expose motion sensors on secure (HTTPS) pages, so the dev server uses a self-signed certificate.

1. Run `npm run dev`.
2. Find your PC's IPv4 address with `ipconfig` (Wi-Fi adapter).
3. Put the phone on the same Wi-Fi and open `https://<pc-lan-ip>:5173`.
4. Accept the certificate warning:
   - iPhone Safari: Show Details > visit this website.
   - Android Chrome: Advanced > Proceed.
5. If the page does not load, allow Node.js through Windows Defender Firewall on private networks.

## Production check

```sh
npm run build
npm start
```

Open `http://localhost:3000`. `http://localhost:3000/healthz` returns `ok`.

## Deploy to Render

1. Push the repo to GitHub.
2. In the Render Dashboard choose New > Blueprint and pick the repo.
3. Apply `render.yaml` and wait for the `/healthz` health check to pass.
4. Open the `onrender.com` HTTPS URL on both phones.

Free instances spin down when idle. That is fine for M1; use a paid instance for demo day, once rooms live in server memory.

## Privacy

Raw motion data stays on the phone. Nothing is sent or stored.

## Device testing

Record real-device results in [docs/device-test-log.md](docs/device-test-log.md).

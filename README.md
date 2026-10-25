# Rival Rockets

Browser party game for four phones. The product spec is [rival-rockets-prd.md](rival-rockets-prd.md).

Current build:

- **Milestone 1 sensor test** (Home > Sensor test): motion permission, calibration, pilot tilt, and engineer shake on one phone.
- **Milestone 2 shared control**: rooms with a six-character code, share link, and QR; four fixed seats; and a development-only *control test* in which the Comet Pilot and Comet Engineer fly one server-owned rocket from two phones. There is no score, timer, or match yet (Milestone 3).

The control test starts by itself once both Comet seats are connected and calibrated, and only when the server's control-test flag is on (`--dev`, or `RR_CONTROL_TEST=1`). Nova seats can be claimed but only watch.

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
| `npm run dev` | Vite dev server over HTTPS on port 5173, reachable from the LAN; proxies `/ws` to port 3000 |
| `npm run dev:server` | Compiles and runs the room server on port 3000 in dev mode (control test on, same-host origin allowed) |
| `npm run typecheck` | Type-checks client, shared, and server code |
| `npm run lint` | ESLint |
| `npm test` | Vitest, single run |
| `npm run build` | Typecheck, build the client to `dist/`, compile the server to `dist-server/` |
| `npm start` | Runs the production server from `dist-server/` (port 3000 or `$PORT`) |
| `npm run check` | Lint, test, and build |

## Test on your phones (HTTPS on your LAN)

Phone browsers only expose motion sensors on secure (HTTPS) pages, so the dev server uses a self-signed certificate. WebSockets go through the same Vite origin, so phones need no second certificate.

1. In one terminal run `npm run dev:server`. In a second terminal run `npm run dev`. `dev:server` does not watch files; rerun it after server changes.
2. Find your PC's IPv4 address with `ipconfig` (Wi-Fi adapter).
3. Put the phones on the same Wi-Fi and open `https://<pc-lan-ip>:5173`.
4. Accept the certificate warning:
   - iPhone Safari: Show Details > visit this website.
   - Android Chrome: Advanced > Proceed.
5. If the page does not load, allow Node.js through Windows Defender Firewall on private networks.

For the control test: create a room on phone A, join from phone B by QR or code, claim Comet Pilot and Comet Engineer, and finish motion setup on both.

## Production check

```sh
npm run build
npm start
```

Open `http://localhost:3000`. `http://localhost:3000/healthz` returns `ok`. Outside dev mode the server only accepts WebSocket origins from `RENDER_EXTERNAL_URL` (set by Render) and the comma-separated `ALLOWED_ORIGINS`; locally, set `ALLOWED_ORIGINS=http://localhost:3000` to use rooms.

## Deploy to Render

1. Push the repo to GitHub.
2. In the Render Dashboard choose New > Blueprint and pick the repo.
3. Apply `render.yaml` and wait for the `/healthz` health check to pass.
4. Open the `onrender.com` HTTPS URL on both phones.

**Enabling the control test on the deployed site** (manual): in the Render dashboard, add the environment variable `RR_CONTROL_TEST=1` and redeploy. While it is on, anyone with the URL can fly the one Comet rocket (no score, no match). Remove it after the device test.

**Paid instance** (manual user decision): `render.yaml` keeps `plan: free`. Free instances spin down after about 15 minutes idle and lose every in-memory room, which phones report as a lost connection. Switch to a paid instance in the dashboard before the deployed M2 latency test and demo day. Check current pricing when you provision.

`RR_TRUSTED_PROXY_HOPS=1` (in `render.yaml`) makes per-IP room limits use the address Render's proxy appends. Confirm on deploy that two phones on different networks get separate limits.

## Privacy

Raw motion data stays on the phone. Phones send only normalized steering, charge events, and ability requests. Rooms, names, and seat tokens live in server memory only and disappear with the room. The reconnect token stays in the tab's session storage and is never put in a link, QR code, or log.

## Device testing

Record real-device results in [docs/device-test-log.md](docs/device-test-log.md). Simulated or desktop input does not count toward the milestone gates.

# Implementation Plan: M2 Shared Control

## Overview

Build M2 in TypeScript on the existing M1 code: shared constants and contracts first, then pure rules with property tests, then the server pieces (validator, limiter, origin check, room store, public view, simulation, dispatch, gateway), then the client network layer and screens, and finally wiring, docs, and verification.

Rules for every task:

- Read the PRD sections and design sections each task names before coding. Follow `AGENTS.md`.
- Every tunable value comes from `src/shared/config.ts` (gameplay, network) or `server/config.ts` (server-only). No inline numbers.
- Run `npm run lint`, `npm test`, and `npm run build` after each task and fix failures before finishing it.
- Do not commit, push, or change `plan: free` in `render.yaml`. Do not create paid services.
- Do not build M3/M4 features: second rocket, course walls, checkpoints, cores, scoring, timer, results, Ready, match start, pause/resume countdown, rematch, role swaps.
- Agents cannot test on physical phones or measure latency on the deployed site. Say so in each report; those checks are in `docs/device-test-log.md` for the user.

## Tasks

- [x] 1. Set up dependencies, build wiring, shared constants, and contracts
  - [x] 1.1 Add dependencies and server build wiring
    - Install exact pins (check with `npm view` first and report any change): `ws` 8.22.0 (dependency), `@types/ws` 8.18.2, `fast-check` 4.10.2, `qrcode-generator` 2.0.4 (devDependencies). `.npmrc` already saves exact versions
    - `tsconfig.node.json`: include `src/shared`. `tsconfig.server.build.json`: `rootDir: "."`, include `server` and `src/shared`, exclude `**/*.test.ts`, emit to `dist-server/`
    - `package.json`: `start` → `node dist-server/server/main.js`; add `dev:server` → `tsc -p tsconfig.server.build.json && node dist-server/server/main.js --dev`
    - `server/main.ts`: resolve `dist` as `../../dist` from the compiled file
    - Switch relative imports inside `src/shared/**` (including tests) to `.js` specifiers so Node ESM can load them
    - `vite.config.ts`: dev proxy `/ws` → `http://localhost:3000` with `ws: true`, keeping the original `Host` header
    - Confirm `npm run build` emits `dist-server/server/main.js` and `npm start` still serves `/healthz`
    - _Requirements: 23.1, 23.2, 7.1_
  - [x] 1.2 Extend shared config with M2 constants
    - Add the constants in the design's Constants table to `src/shared/config.ts`, with short "why" comments and PRD section references
    - Make `PREVIEW_ARENA_WIDTH/HEIGHT`, `PREVIEW_SPEED_UNITS_PER_S`, `PREVIEW_MAX_TURN_DEG_PER_S`, `PREVIEW_ROCKET_LENGTH` aliases of the shared values
    - Add server-only values to `server/config.ts`: `WS_PATH`, `WS_MAX_FRAME_BYTES`, `SIMULATION_LOOP_INTERVAL_MS`, `MAX_CATCH_UP_STEPS`, `HOUSEKEEPING_INTERVAL_MS`, `RATE_WINDOW_MS`, `IP_RATE_WINDOW_MS`
    - _Requirements: 1.1, 1.2, 1.4_
  - [ ]* 1.3 Write unit tests for shared config
    - Assert every PRD value from Requirement 1.1 and that PREVIEW aliases equal the shared values
    - _Requirements: 1.1, 1.4_
  - [x] 1.4 Create the shared protocol module
    - `src/shared/protocol.ts`: `TeamId`, `Role`, `SeatId`, `SEAT_IDS`, `Intent`, `SetupStatus`, `ClientMessage`, `ServerMessage`, public state shapes, `RejectReason`, as in the design
    - No `ready.set`, `match.start`, `match.rematch`, or `match.swap` types in M2
    - _Requirements: 1.3, 8.7, 17.8_

- [ ] 2. Implement the pure rules
  - [x] 2.1 Extend `src/shared/rules/abilities.ts` with server-owned selection
    - Add `selectedAbility` (starts `DEFAULT_ABILITY`), `selectAbility`, `activateSelected`, `clearExpiredEffect`; keep existing functions and the M1 sensor test working
    - Rejections keep returning the same state object
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_
  - [ ]* 2.2 Write property test for energy bounds
    - **Property 15: Energy stays within 0 to 100**
    - **Validates: Requirements 14.10**
  - [ ]* 2.3 Write property test for charge spacing
    - **Property 16: At most one charge per second**
    - **Validates: Requirements 14.3, 14.11**
  - [ ]* 2.4 Write property test for failed operations
    - **Property 17: Failed operations spend nothing**
    - **Validates: Requirements 14.3, 14.4, 14.7, 14.8, 14.12**
  - [ ]* 2.5 Write property test for accepted operation effects
    - **Property 18: Accepted operations have exactly their effect**
    - **Validates: Requirements 14.2, 14.5, 14.6, 14.9**
  - [x] 2.6 Implement `src/shared/rules/physics.ts`
    - `RocketPose`, `createStartPose`, `normalizeHeading`, `stepRocket` with steering/dt sanitizing, base speed, boost multiplier, turn rate, and the inset arena clamp (M2 boundary only)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_
  - [ ]* 2.7 Write property test for rocket bounds
    - **Property 19: The rocket stays finite and in the arena**
    - **Validates: Requirements 15.6, 15.7**
  - [ ]* 2.8 Write property test for speed and boost
    - **Property 20: Speed follows the base speed and boost multiplier**
    - **Validates: Requirements 15.1, 15.2**
  - [ ]* 2.9 Write property test for turning
    - **Property 21: Turning follows steering; neutral keeps heading**
    - **Validates: Requirements 15.3, 15.4, 15.8**
  - [-] 2.10 Implement `src/shared/rules/seats.ts`
    - `claimSeat`, `releaseSeat`, `switchToWatch`, `removeParticipant`, `canJoinAsPlayer`, `nextHost`, `cometCrewReady`; failures return a reason and no state
    - _Requirements: 2.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_
  - [ ]* 2.11 Write property test for seat invariants
    - **Property 1: Seat operations keep seats unique**
    - **Validates: Requirements 2.5, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.10, 4.11**
  - [ ]* 2.12 Write property test for host transfer
    - **Property 2: Host transfer picks the longest-connected seated player**
    - **Validates: Requirements 4.8, 4.9, 4.10**
  - [~] 2.13 Implement `src/shared/rules/control-test.ts`
    - `createControlTest(matchId)` (start pose, fresh crew) and `stepControlTest(state, inputs)` with the design's step order; one result per input; no clock or random access
    - _Requirements: 12.2, 12.3, 14.1, 15.5, 16.1, 16.3, 16.4_
  - [ ]* 2.14 Write property test for the control test step
    - **Property 14: Each step advances one tick and answers every input**
    - **Validates: Requirements 12.2, 12.3, 16.1, 16.4**
  - [ ]* 2.15 Write unit tests for step order
    - Boost activated in a step moves at 1.5× in that step; activation exactly at cooldown end succeeds; charge then activate in one batch uses the new energy
    - _Requirements: 16.3_

- [~] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement the server's pure pieces
  - [~] 4.1 Implement `server/validate.ts`
    - `validateMessage` with the design's check order, exact field sets, integer and string bounds, finite checks, steering clamp, code and token formats; `normalizeName` with trim, NFC, control/line-break rejection, `Intl.Segmenter` grapheme count
    - Reject `activate` with an `ability` field as `invalid-field`; unknown and M3 types as `unknown-type`; never throw
    - _Requirements: 2.6, 2.7, 8.1, 8.3, 8.4, 8.5, 12.1, 14.9, 17.8, 18.2_
  - [ ]* 4.2 Write property test for validator totality
    - **Property 9: The validator is total**
    - **Validates: Requirements 8.1, 8.3, 8.5, 14.9, 17.8**
  - [ ]* 4.3 Write property test for steering clamp
    - **Property 10: Steering is clamped**
    - **Validates: Requirements 8.4**
  - [ ]* 4.4 Write property test for display names
    - **Property 5: Display name normalization**
    - **Validates: Requirements 2.6, 2.7**
  - [ ]* 4.5 Write unit tests for each validator reason
    - One example per `RejectReason` the validator returns; M3 message types; `setup.update` with extra fields
    - _Requirements: 8.1, 12.1, 17.8, 18.2_
  - [-] 4.6 Implement `server/rate-limit.ts`, `server/origin.ts`, `server/client-ip.ts`
    - Sliding-window `tryHit`; `buildAllowedOrigins` from `RENDER_EXTERNAL_URL` and `ALLOWED_ORIGINS`; `isOriginAllowed` with the dev same-host rule; `clientIp` with `RR_TRUSTED_PROXY_HOPS` read from the right of `X-Forwarded-For`
    - _Requirements: 2.9, 7.2, 7.3, 7.4, 9.1, 9.2, 9.3, 9.4_
  - [ ]* 4.7 Write property test for window limiters
    - **Property 12: Window limiters never exceed their limit**
    - **Validates: Requirements 2.9, 9.1, 9.2, 9.3**
  - [ ]* 4.8 Write property test for origin checks
    - **Property 27: Origin checks allow only listed or same-host origins**
    - **Validates: Requirements 7.2, 7.4**
  - [ ]* 4.9 Write unit tests for origin env parsing and client IP
    - Env combinations including empty and malformed entries; 0 and 1 trusted hops; spoofed leftmost `X-Forwarded-For` entries
    - _Requirements: 7.3, 2.9_
  - [~] 4.10 Implement `server/rooms.ts` (Room_Store)
    - Injected `nowMs`, `randomInt`, `randomToken`; create/join/claim/release/watch/leave/setSetup/disconnect/reconnect/sweep/touch per the design
    - Room codes from the alphabet with collision retry; 16-byte base64url tokens issued on every claim; `timingSafeEqual` comparison; 15 s seat holds; 30 min expiry; host transfer via `seats.ts`
    - Only accepted actions call `touch`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.8, 4.9, 5.1, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 18.3_
  - [ ]* 4.11 Write property test for room codes
    - **Property 3: Room codes are valid and unique**
    - **Validates: Requirements 2.2**
  - [ ]* 4.12 Write property test for create and join
    - **Property 4: Create and join either add one participant or change nothing**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5**
  - [ ]* 4.13 Write property test for reconnect tokens
    - **Property 8: Reconnect succeeds only with the live token**
    - **Validates: Requirements 5.7, 5.8, 5.9**
  - [ ]* 4.14 Write unit tests for Room_Store timing and lifecycle
    - Seat hold at 14999/15000 ms; expiry at 1799999/1800000 ms; activity refresh per accepted action; code reuse after expiry; token length and per-claim rotation
    - _Requirements: 5.1, 5.6, 6.1, 6.3, 6.4_
  - [~] 4.15 Implement `server/public-view.ts`
    - `toRoomState`, `toMatchState`, `toAck` built field by field; no spreading of server records
    - _Requirements: 5.3, 5.4, 12.4, 12.5, 16.6, 17.4_
  - [ ]* 4.16 Write property test for public view privacy
    - **Property 7: Public state never leaks private data**
    - **Validates: Requirements 5.3, 5.4**

- [ ] 5. Implement the server runtime
  - [~] 5.1 Implement `server/simulation.ts`
    - Control test runtime per room: queue, accumulator, freeze flag, next broadcast time; global loop with `performance.now()`, fixed `STEP_MS`, `MAX_CATCH_UP_STEPS` cap, ~18 Hz broadcasts on step boundaries
    - Start when the flag is on and `cometCrewReady`; freeze with steering 0 on a Comet disconnect; resume on reconnect; end on seat reopen or occupant change; reject leftover queued inputs as `stale-match`
    - Flag from `--dev` or `RR_CONTROL_TEST=1`
    - Accept a clock and outbound sender as parameters so tests run without timers or sockets
    - _Requirements: 11.4, 12.2, 16.1, 16.2, 16.5, 17.1, 17.2, 17.3, 17.5, 17.6, 17.7_
  - [ ]* 5.2 Write unit tests for the simulation
    - Broadcast count over 10 s of fake time is 180 ± 1; 1 s gap runs `MAX_CATCH_UP_STEPS` steps; lifecycle start/off/freeze/resume/end; Pilot disconnect zeroes steering; env flag parsing
    - _Requirements: 11.4, 16.2, 16.5, 17.1, 17.2, 17.3, 17.5, 17.6, 17.7_
  - [~] 5.3 Implement `server/dispatch.ts`
    - Socket-free handling in the design's order: connection limit, validation, membership/role/phase, per-seat limit, `matchId` and `seq`, then Room_Store or simulation queue; produce `request.rejected`, rejected `input.ack`, private `session.accepted`, and room-wide `room.state`
    - Per-IP create/join limits count failures; `retryAfterMs` on rate-limit rejections; catch handler exceptions without logging identifiers
    - _Requirements: 2.4, 2.5, 2.9, 5.2, 8.2, 8.6, 9.1, 9.2, 9.3, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 12.3, 13.1, 18.3_
  - [ ]* 5.4 Write property test for rejected messages
    - **Property 11: Rejected messages change nothing**
    - **Validates: Requirements 6.2, 8.2, 8.6**
  - [ ]* 5.5 Write property test for input authorization
    - **Property 13: Only the bound crew seat controls the rocket**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**
  - [~] 5.6 Implement the Gateway and wire it into the server
    - `server/websocket.ts`: `WebSocketServer({ noServer: true, maxPayload: WS_MAX_FRAME_BYTES })`, upgrade path and origin check with 403, connection records with source IP kept in memory only, heartbeat replies, housekeeping interval for heartbeat timeouts and `rooms.sweep()`, `room.error` on expiry, one active connection per seat
    - `server/main.ts`: create store, simulation, and gateway on the existing HTTP server; send `room.error server-closing` on SIGTERM/SIGINT before closing
    - `server/app.ts`: CSP `connect-src 'self'` plus the `wss://` form of each allowed origin; fix the M1 comment
    - Log only startup, config errors, and counts; never names, codes, tokens, IPs, or sensor data
    - _Requirements: 5.2, 5.10, 6.3, 7.1, 7.2, 7.3, 7.5, 7.6, 11.2, 11.3, 22.6_
  - [ ]* 5.7 Write integration tests for the Gateway
    - In-process server on port 0 with the `ws` client: allowed origin connects, bad origin gets 403, other path refused; only the claimant gets the token; reconnect closes the older socket; heartbeat ack; Pilot and Engineer clients get applied acks and `match.state`; CSP lists `wss://` origins
    - _Requirements: 5.2, 5.10, 7.1, 7.2, 7.5, 11.2, 12.2_

- [~] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement the client network layer
  - [-] 7.1 Implement `src/client/net/session.ts`
    - Session storage of `{ code, seat, token }` for the tab; `buildShareLink` and `parseRoomParam`
    - _Requirements: 3.2, 3.3, 5.5_
  - [ ]* 7.2 Write property test for share links
    - **Property 6: Share links carry only the room code**
    - **Validates: Requirements 3.2, 3.3, 5.5**
  - [-] 7.3 Implement `src/client/net/latency.ts`
    - `createLatencyMonitor` with per-kind windows, pending send map with timeout, render delay samples, nearest-rank `percentile`, numeric-only `summary`
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7_
  - [ ]* 7.4 Write property test for latency samples
    - **Property 25: Latency samples match their sends**
    - **Validates: Requirements 22.1, 22.2**
  - [ ]* 7.5 Write property test for latency statistics
    - **Property 26: Latency statistics are well ordered**
    - **Validates: Requirements 22.3, 22.7**
  - [-] 7.6 Implement `src/client/net/interpolate.ts`
    - `interpolatePose`, snapshot buffer, `sampleAt` holding the newest pose, `estimateRenderTime` with the minimum-offset clock estimate and `INTERPOLATION_DELAY_MS`; reset on new `matchId` and on freeze changes
    - _Requirements: 20.1, 20.2, 20.3, 20.4_
  - [ ]* 7.7 Write property test for interpolation bounds
    - **Property 22: Interpolation stays between snapshots**
    - **Validates: Requirements 20.2, 20.3, 20.4**
  - [ ]* 7.8 Write property test for render time
    - **Property 23: Render time never runs ahead of received data**
    - **Validates: Requirements 20.1**
  - [~] 7.9 Implement `src/client/net/socket.ts`
    - Same-origin `wss:`/`ws:` URL, `requestId` and per-connection `seq`, 1 s heartbeat, 3 s silence detection, reconnect with the stored token, steering throttle at `CLIENT_STEERING_HZ`, latency monitor hooks on send and ack
    - Inject the WebSocket constructor and clock for tests
    - _Requirements: 9.6, 11.1, 11.5, 12.1, 13.3, 22.1_
  - [ ]* 7.10 Write unit tests for the socket client
    - Fake timers and a mock socket: heartbeat cadence, silence → reconnect with token, `reconnect-denied` → closed, steering throttle at 20 Hz, `seq` restarts per connection
    - _Requirements: 9.6, 11.1, 11.5_

- [ ] 8. Implement the client screens
  - [-] 8.1 Add server-authority mode to the motion controller and the crew view reducer
    - `createMotionController(role, { authority })`: server mode emits `charge-requested`, `activate-requested`, `selection-changed`; add `syncSelection`; local mode unchanged for the M1 sensor test
    - `src/client/crew-view.ts`: pure reducer reconciling local predictions to server crew state
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.7_
  - [ ]* 8.2 Write property test for the crew view
    - **Property 24: Displayed crew state follows the server**
    - **Validates: Requirements 19.5**
  - [ ]* 8.3 Write unit tests for controller server mode
    - Gesture emits `charge-requested` and leaves local crew state alone; Activate emits `activate-requested`; blocked gives steering 0 and no selection events
    - _Requirements: 19.2, 19.3, 19.4, 19.7_
  - [~] 8.4 Implement `src/client/room-context.ts`
    - Latest `room.state` and `match.state`, own participant and seat, snapshot buffer, crew view, net client, `go` and `announce` callbacks for room screens
    - _Requirements: 19.5, 20.1, 21.2_
  - [~] 8.5 Extract the pilot and engineer panels
    - Move the gauge and engineer panel DOM from `pilot-screen.ts` and `engineer-screen.ts` into `ui/pilot-panel.ts` and `ui/engineer-panel.ts`, fed by a view object; the M1 sensor test screens use them unchanged in behavior
    - _Requirements: 19.1, 19.9_
  - [ ] 8.6 Update `src/client/ui/arena-canvas.ts`
    - Draw a `RocketPose` with optional boost and shield state (boost trail, shield outline in `--shield`), keeping the existing `draw` callers working
    - _Requirements: 20.5_
  - [~] 8.7 Implement copy, QR, and the home, join, and error screens
    - `ui/copy.ts`: player copy per reject reason and room error (design Error Handling table), developer-only marker for protocol reasons
    - `ui/qr.ts`: `qrcode-generator` matrix drawn as SVG `rect` nodes via `createElementNS`
    - `ui/home-screen.ts`, `ui/join-screen.ts` (create and join modes, code prefill, Watch option, inline errors), `ui/error-screen.ts` (Create room, Join room); names as `textContent` only
    - _Requirements: 2.8, 3.5, 13.2, 13.3_
  - [ ]* 8.8 Write unit tests for the copy map
    - Every `RejectReason` and room error maps to copy or the developer-only marker
    - _Requirements: 13.2_
  - [~] 8.9 Implement `src/client/ui/lobby-screen.ts`
    - Room code, QR of the share link, Share link (Web Share API or clipboard with "Link copied"), two team columns with Pilot/Engineer seat cards (Open, Taken, Calibrated, Disconnected), Watch link, Leave, control test status line; claim opens setup
    - _Requirements: 3.1, 3.4, 4.2, 18.1_
  - [~] 8.10 Connect the setup screen to the room
    - When in a room, send `setup.update readings` after the sensor check and `setup.update calibrated` after Set neutral; Watch instead sends `room.watch` and opens the Watch view; denial and no-data keep status unverified
    - _Requirements: 18.1, 18.2, 18.4, 18.5_
  - [~] 8.11 Implement the control screen and crew status row
    - `ui/control-screen.ts`: "CONTROL TEST · not a match" strip, interpolated arena, Pilot panel with `ui/crew-status.ts`, Engineer panel fed by the crew view; send steer at 20 Hz, charge on gesture with local pop, select on local change, activate on tap with pressed state; show rejection reason for 1.5 s; rotate overlay sends steering 0; Nova seats get the read-only arena and note; record render delay
    - _Requirements: 17.9, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.10, 20.1, 22.4_
  - [~] 8.12 Implement `src/client/ui/room-watch-screen.ts`
    - Room code, four seats with names and connection state, interpolated arena, waiting message, control test label; no motion request and no gameplay input
    - _Requirements: 17.9, 21.1, 21.2, 21.3, 21.4_
  - [~] 8.13 Add latency diagnostics to the debug panel
    - Show count, median, p95 per input kind and render delay p95 against `LATENCY_TARGET_P95_MS`; add the summary to "Copy readings"; numbers only
    - _Requirements: 22.3, 22.4, 22.6_
  - [~] 8.14 Wire the room flow into `src/client/app.ts`
    - New screen names, room context creation on Create or Join, `?room=` prefill, reconnect from session storage on reload, error card on lost connection, Home as the start screen with a Sensor test link to the M1 start screen
    - _Requirements: 3.3, 11.5, 13.3, 18.1, 21.1_

- [~] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Update docs and run final verification
  - [~] 10.1 Update `render.yaml` and `README.md`
    - `render.yaml`: add `envVars` with `RR_TRUSTED_PROXY_HOPS: "1"` and a comment to verify it on deploy; keep `plan: free`
    - README: M2 overview, two-terminal LAN dev (`npm run dev:server`, `npm run dev`), enabling `RR_CONTROL_TEST=1` in the Render dashboard for the device test, and the paid-instance switch as a manual user decision with the reason
    - _Requirements: 23.3, 23.5_
  - [~] 10.2 Add the M2 section to `docs/device-test-log.md`
    - M2 scenario checklist from the design's Manual verification list, and an empty row template for two-phone shared control (iPhone Safari, Android Chrome) with columns for p95 send-to-ack per input kind and render delay p95
    - State that agents did not run these checks
    - _Requirements: 23.4_
  - [~] 10.3 Add the M2 copy to PRD Section 7.9
    - Add a "Rooms and control test (Milestone 2)" block with the copy from `ui/copy.ts`, marked as proposed until the user approves it
    - _Requirements: 13.4_
  - [~] 10.4 Run the full verification sequence
    - `npm ci`, `npm run lint`, `npm test`, `npm run build`; `npm start` in the background, check `/healthz` and a WebSocket connect to `/ws` with an allowed origin, then stop the process; delete temporary files
    - Report what passed and list every manual check left for the user
    - _Requirements: 23.1, 23.2_

- [~] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - The M2 exit (two physical phones reliably share one rocket, plus deployed-site latency) is not verified by agents. The user runs the checklist in `docs/device-test-log.md` and records the results.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Property tests use fast-check with at least 100 runs and a `// Feature: m2-shared-control, Property N: <title>` tag.
- Each task references requirements for traceability. Checkpoints keep the build green between layers.
- Manual user steps, not agent tasks: switching Render to a paid plan, setting `RR_CONTROL_TEST=1` in the Render dashboard, and the two-phone device and latency checks.
- Optional property and unit test tasks that write to the same test file are placed in separate waves.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.6"] },
    { "id": 2, "tasks": ["2.10", "4.6", "7.1", "7.3", "7.6", "8.1", "8.6"] },
    { "id": 3, "tasks": ["2.13", "4.1", "7.9", "8.5"] },
    { "id": 4, "tasks": ["4.10", "8.4", "8.13"] },
    { "id": 5, "tasks": ["4.15", "8.7", "8.10"] },
    { "id": 6, "tasks": ["5.1", "8.9"] },
    { "id": 7, "tasks": ["8.11"] },
    { "id": 8, "tasks": ["8.12"] },
    { "id": 9, "tasks": ["5.3", "8.14"] },
    { "id": 10, "tasks": ["10.1", "10.2", "10.3"] },
    { "id": 11, "tasks": ["5.6"] },
    { "id": 12, "tasks": ["10.4"] },
    { "id": 13, "tasks": ["1.3", "2.2", "2.7"] },
    { "id": 14, "tasks": ["2.3", "2.8", "2.11", "4.7", "7.2", "7.4", "7.7", "8.2", "8.3"] },
    { "id": 15, "tasks": ["2.4", "2.9", "2.12", "2.14", "4.2", "4.8", "7.5", "7.8", "7.10"] },
    { "id": 16, "tasks": ["2.5", "2.15", "4.3", "4.9", "4.11"] },
    { "id": 17, "tasks": ["4.4", "4.12", "4.16", "8.8"] },
    { "id": 18, "tasks": ["4.5", "4.13", "5.2"] },
    { "id": 19, "tasks": ["4.14", "5.4"] },
    { "id": 20, "tasks": ["5.5", "5.7"] }
  ]
}
```

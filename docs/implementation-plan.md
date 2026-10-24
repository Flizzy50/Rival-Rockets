# Rival Rockets implementation plan

Based on [PRD v1.2](../rival-rockets-prd.md), dated October 24, 2026, and [AGENTS.md](../AGENTS.md).

**Status: planning only; D1-D7 resolved as starting decisions on October 24, 2026.** The selected stack is TypeScript with Vite, native DOM/CSS/Canvas, and a Node.js/Express/`ws` server targeted for Render. There is no application, dependency manifest, executable build command, or installed test runner yet. The tree and schemas below are planned implementation boundaries, not generated code or validated behavior. The PRD remains the source of truth. D2 motion values require physical-device validation before the M1 gate passes.

## 1. Scope and decisions

Build one browser game for exactly four active players: Comet Pilot, Comet Engineer, Nova Pilot, and Nova Engineer. Use one 2D course, server-authoritative gameplay, in-memory rooms, and optional spectators. Support the PRD's Watch recovery paths with a read-only shared arena view; the dedicated large-screen spectator presentation belongs to optional M5 work. No database schema, accounts, matchmaking, extra roles, extra courses, native app, or 3D engine is needed.

D1 selects Option A below and records it in `AGENTS.md`. The proposed source and test files now use `.ts`. This decision resolves the planning choice; scaffolding and deployment are separate tasks. Create each file only when its milestone needs it.

### D1 decision: TypeScript without a UI framework, deployed on Render

**Decision:** select Option A for the current MVP. The user requested a comparison, recommendation, and resolution of D1. This records that planning decision without installing packages, creating a service, or incurring hosting charges. D2-D7 are resolved in PRD Sections 4, 5, 7, and 8.

Both options use TypeScript across client and server, native browser motion APIs, Canvas 2D, CSS, native browser WebSocket clients, and a Node.js 24 LTS server with Express and `ws`. One npm package contains the client, server, and shared pure rules. Node 24 is an LTS line; pin a compatible exact patch and exact package versions when scaffolding. [Node release status](https://nodejs.org/en/about/previous-releases)

| Area | Option A — selected | Option B — alternative |
| --- | --- | --- |
| Client | Vite + TypeScript, native DOM controls, plain CSS, Canvas 2D. | Vite + React + TypeScript, React DOM controls, plain CSS, Canvas 2D. |
| Server | Node.js 24 LTS + Express for HTTP/static files + `ws` for WebSockets. | Same server stack; React does not replace the authoritative simulation. |
| Build/checks | npm, Vite, TypeScript compiler, ESLint + typescript-eslint, Vitest. | Same tools, plus React's Vite plugin and React-specific lint rules. |
| Multiplayer deployment | One paid Render Web Service; one instance and one Node process serve the client and WSS endpoint. | One Railway Hobby service; one replica and one Node process serve the client and WSS endpoint, with Serverless sleeping disabled. |
| Main advantage for this project | Fewer client runtime dependencies and direct ownership of motion listeners, DOM feedback, and the canvas loop. | Components and declarative state updates help organize the lobby, setup, controls, and results if the team already prefers React. |
| Main tradeoff | We must explicitly update DOM state and clean up event listeners; avoid building a homemade UI framework. | Adds a UI runtime and component/effect lifecycle to integrate with sensor listeners and the frame loop. Keep frame-by-frame canvas work outside React rendering. |
| Hosting cost shape | Fixed compute price for the selected instance, plus applicable usage charges. | Usage-based bill with a monthly minimum. |

These are two complete deployment choices, not technical pairings: either frontend could run on either host. Vite supports both vanilla TypeScript and React TypeScript; React's own documentation describes the Vite route. [Vite templates](https://vite.dev/guide/), [React with Vite](https://react.dev/learn/build-a-react-app-from-scratch)

**Why A:** the PRD's hardest work is sensor processing and authoritative real-time rules. The UI has a bounded set of screens and an imperative canvas renderer. A direct TypeScript client keeps this proof small, while shared types reduce accidental disagreement between client and server. React remains a reasonable alternative if existing team familiarity outweighs that simplicity; there is no claim that either option has already met the load-size, frame-rate, or device targets.

**Hosting facts checked October 24, 2026:** Render supports inbound WebSockets and does not impose a maximum connection duration, although deployments, maintenance, and network failures can disconnect clients. Railway also supports WebSockets and exempts them from its HTTP request duration/inactivity limits. [Render WebSockets](https://render.com/docs/websocket), [Railway network limits](https://docs.railway.com/networking/public-networking/specs-and-limits)

Render lists a `0.5c-512mb` web service at **$7/month for compute**; it is the renamed Starter size. Start there for measurement, not as a proven capacity guarantee. A Render Hobby workspace has no monthly workspace fee; bandwidth/build overages, taxes, or other services can add cost. Railway Hobby has a **$5 monthly minimum including $5 of resource usage**, with usage above that billed additionally. Verify the price at provisioning; neither figure is a guaranteed total project bill. [Render published compute baseline](https://render.com/articles/production-rails-hosting-guide), [Render plan names](https://render.com/docs/compute-plans-update), [Render billing](https://render.com/docs/faq), [Railway pricing](https://docs.railway.com/pricing/plans)

### D1 implementation and deployment boundaries

1. **M1:** build only the sensor client and its small tests. One Render Web Service configured by `render.yaml` serves the built sensor-test client and `/healthz` over HTTPS. No game logic or WebSockets before the physical-device gate passes. [Render service types and free deployment](https://render.com/docs/your-first-deploy)
2. **After the physical-device M1 gate:** attach `ws` to the M1 Express server in M2. Move the active demo link to one paid Render Web Service that serves both built client assets and `/ws` on the same public origin. The M1 free web service is a sensor prototype, not a second production frontend. Express provides static-file middleware. [Express static files](https://expressjs.com/en/starter/static-files/)
3. **One live authority:** use one instance, one Node process, and one region selected against the demonstration network. Do not enable horizontal autoscaling, clustering, or multiple replicas while rooms live only in memory. Render can route separate WebSocket connections to different instances; a second independent process would not share the room. [Render connection routing](https://render.com/docs/websocket)
4. **No idle shutdown for multiplayer:** use paid web compute. Render's free web services can sleep after 15 minutes without inbound traffic and take about a minute to wake; paid compute does not idle-spin-down. Sleeping would erase this game's in-memory rooms. For Option B, keep Railway Serverless disabled for the same reason. [Render free limits](https://render.com/docs/free), [Render paid behavior](https://render.com/docs/faq), [Railway Serverless](https://docs.railway.com/deployments/serverless)
5. **Deployment lifecycle:** bind the server to the provider's port on `0.0.0.0`; let the host terminate HTTPS/WSS. Allow only the intended browser origin. A restart/redeploy can end rooms, as allowed by the PRD; show recovery rather than declaring a match winner. Avoid deploying during a demo match, and use manual releases for the demo service. Never treat a zero-downtime HTTP deployment as preservation of in-memory game state.
6. **Build and verification:** Vite builds the client; `tsc` type-checks source/tests and compiles the server to `dist-server/`. ESLint with typescript-eslint checks code, and Vitest runs pure-rule and transport tests. TypeScript types do not validate incoming JSON; server runtime validation is still mandatory. Vitest can reuse Vite configuration, so do not add a separate test config unless needed. [Vitest setup](https://vitest.dev/guide/), [typescript-eslint setup](https://typescript-eslint.io/getting-started/)

The command contract to implement in the manifest is `npm run dev`, `npm run typecheck`, `npm run build`, `npm run lint`, `npm test`, and the production `npm start` server command, all present since M1 scaffolding. The build must include type checking rather than relying on Vite's transpilation alone. Use one lockfile and `npm ci` for repeatable deployment. Browser target settings must follow the actual presentation devices tested in M1; tooling compatibility is not evidence that permission or sensor behavior works.

### Decision register

The PRD now contains the decisions below, including the tutorial and results explanation affected by gameplay rules. The values are implementation starting points, not measured outcomes. A future playtest change updates the PRD, shared config, tutorial, and results explanation together.

| ID | Decision / question | Status / needed before |
| --- | --- | --- |
| D1 | Option A: TypeScript + Vite + native DOM/CSS/Canvas; Node.js 24 LTS + Express + `ws`; npm, TypeScript compiler, ESLint/typescript-eslint, Vitest; one free Render Web Service sensor prototype in M1, one paid Render Web Service in M2. | Resolved October 24, 2026. Versions are pinned in `.node-version` and `package.json`. M1 is implemented; the physical-device gate is pending Android. |
| D2 | Portrait gamma relative to a one-second neutral; 4° stability range and dead zone, full tilt at 28°, 80 ms smoothing. Require three readings spanning 2°; Engineer selection at 12° held 300 ms; two distinct filtered shake peaks above 12 m/s², 80–450 ms apart, then 300 ms quiet. | Resolved as **unvalidated starting values** in PRD Section 5. M1 real iPhone/Android tests still decide whether they are usable. |
| D3 | Names: 1–16 graphemes; six-character unambiguous code; 1024-byte client messages; one-second heartbeat; specified per-IP/per-seat limits; only accepted actions/input refresh room activity. | Resolved in PRD Section 8. Implement server enforcement in M2. |
| D4 | One 600 × 800 rounded-ring course with four gates and four core spawns; 120 units/s base speed, 120°/s maximum turn, 1.5× boost, wall/bump/shield rules and deterministic simultaneous-event order. | Resolved as playtest geometry/physics in PRD Sections 4 and 8. Implement in M2-M3. |
| D5 | Boost selected at match start. Engineer sends `ability.request` for selection or activation; server owns and broadcasts the choice to the Pilot. | Resolved in PRD Sections 5 and 8. Implement in M2. |
| D6 | Both teammates confirm an intra-crew role swap; recheck/calibrate/practice the new role and rotate tokens. Host starts a fresh, unready lobby after Rematch. Reconnect must restore usable controls within the held-seat window. | Resolved in PRD Sections 7.7 and 8. Implement in M4. |
| D7 | Each disconnect has a separate 15-second deadline; start countdown aborts, resume countdown restarts after a new disconnect; disconnection precedes simultaneous deadline completion; scoring uses match time below 90 s. | Resolved in PRD Section 8. Implement fake-time tests in M4. |

## 2. Proposed file tree

`[M1]` through `[M5]` indicate the first milestone that needs a file, not when all work on it is finished. This is one repository and one npm package, without a workspace/package layer or generic framework of services.

```text
Rival-Rockets/
|-- AGENTS.md                         Existing rules and selected D1 stack
|-- rival-rockets-prd.md              Product source of truth
|-- docs/
|   |-- implementation-plan.md       This plan
|   |-- device-test-log.md           [M1] Devices, versions, observations, measurements
|   `-- deployment.md                [M1] HTTPS/WSS deployment and restart behavior
|-- README.md                        [M1] Setup and actual build/lint/test commands
|-- .gitignore                       [M1] Outputs, local config, secrets
|-- package.json                     [M1] Exact dependency versions and commands
|-- package-lock.json                [M1] One dependency lockfile
|-- index.html                       [M1] Browser entry for Vite
|-- vite.config.ts                   [M1] Client build; Vitest reuses this configuration
|-- tsconfig.json                    [M1] Strict client/shared/test type checking
|-- tsconfig.server.json             [M2] Server and shared-rule compilation for Node
|-- eslint.config.mjs                [M1] ESLint and typescript-eslint rules
|-- public/
|   `-- fonts/                       [M5] Space Grotesk, Inter, and their licenses
|-- src/
|   |-- shared/
|   |   |-- config.ts                [M1] Named gameplay, motion, and network constants
|   |   |-- design-tokens.ts         [M1] One token source for DOM and canvas
|   |   |-- schema.ts                [M2] Public state and message contracts
|   |   |-- course.ts                [M3] One course: walls, forward gates, spawns, cores
|   |   `-- rules/
|   |       |-- seats.ts             [M2] Membership, role ownership, start eligibility
|   |       |-- physics.ts           [M2] Movement, containment, collisions
|   |       |-- abilities.ts         [M2] Charge, energy, effects, shared cooldown
|   |       |-- scoring.ts           [M3] Ordered forward gates and score calculation
|   |       |-- pickups.ts           [M3] Course cores, drops, reclaim and expiry
|   |       `-- match.ts             [M3] Game step, clock, results; pause/reset in M4
|   |-- server/
|   |   |-- main.ts                  [M2] Start server and connect transport to rooms
|   |   |-- rooms.ts                 [M2] In-memory state, seats, private tokens, expiry
|   |   |-- websocket.ts             [M2] Origin, validation, limits, dispatch, acks
|   |   `-- simulation.ts            [M2] Fixed steps, broadcast timing, public snapshots
|   `-- client/
|       |-- main.ts                  [M1] App entry, screen flow, visibility/wake lock
|       |-- styles.css               [M1] Portrait layout, safe areas, accessible controls
|       |-- socket.ts                [M2] WSS lifecycle, inputs, acks, snapshot buffer
|       |-- arena.ts                 [M2] Interpolated arena; isolated practice in M3
|       |-- feedback.ts              [M5] Visual events; optional sound/haptics and mute
|       |-- motion/
|       |   |-- sensors.ts           [M1] Permissions, usable readings, sensor lifecycle
|       |   `-- controls.ts          [M1] Neutral tilt, filtering, shake, selection lock
|       |-- screens/
|       |   |-- motion-setup.ts      [M1] Enable, check, calibrate, recover
|       |   |-- practice.ts          [M3] Isolated role practice, no match mutations
|       |   |-- home-join.ts         [M2] Create/join, name/code validation
|       |   |-- lobby.ts             [M2] Four seats, code/link/QR, ready/start status
|       |   |-- match.ts             [M2] DOM HUD/role panels over the canvas
|       |   |-- results.ts           [M3] Winner/draw and breakdown; rematch/swap in M4
|       |   `-- spectator.ts         [M5] Optional 16:9 arena, crew panels, event ticker
|       `-- ui/
|           |-- hud.ts               [M2] Scores, timer, core pips, crew identity
|           |-- role-panel.ts        [M1] Pilot gauge or engineer meter/selection/activate
|           `-- status-overlay.ts    [M1] Rotation/errors; countdown/pause/interruption later
`-- tests/
    |-- motion.test.ts               [M1] Filtering/lock logic; cannot validate hardware
    |-- seats.test.ts                [M2] Unique seats, role permissions, start gate
    |-- abilities.test.ts            [M2] Charge/cost/effect/cooldown boundaries
    |-- physics.test.ts              [M2] Wall containment and collision behavior
    |-- transport.test.ts            [M2] Validation, origin, unauthorized/replayed inputs
    |-- scoring.test.ts              [M3] Forward ordered crossings and totals
    |-- pickups.test.ts              [M3] Ownership, capacity, drop/respawn timing
    `-- match.test.ts                [M3] Deadline/results; pause/reconnect/rematch in M4
```

Small fixtures can live beside their tests. Do not add fixture factories, a generic event bus, a database layer, an asset pipeline, or separate packages until the implementation actually requires them. Optional audio assets and the dedicated spectator screen are added only if used. M1 uses a simple DOM sensor indicator and role panel, not a practice course or match simulation.

### Module boundaries

| Boundary | Responsibility |
| --- | --- |
| Client motion | Keep raw sensor samples and calibration local. Produce capped steering and discrete charge/ability intents; update local feedback immediately. |
| Client rendering | Interpolate server snapshots. Render HUD and controls as DOM; draw the arena on canvas. Never decide scoring, energy, collisions, or pickup ownership. |
| Shared pure rules | Take explicit state, validated input, and elapsed time; return next state and events. No sockets, browser APIs, storage, randomness, or implicit clocks inside rule functions. |
| Server transport | Authenticate each connection's current seat, validate and rate-limit messages, pass intents to rules, and return applied-state acknowledgements. |
| Server orchestration | Own room memory, private credentials, server time, simulation, reconnect deadlines, and public serialization. Supply time and identifiers to pure rules. |

The server may use the shared rule modules; clients importing types or practice helpers does not grant clients authority. Keep server-private schemas beside `rooms.ts`, outside the public schema. Copy only explicitly allowed fields into broadcasts.

```mermaid
flowchart LR
    A[Phone sensors] --> B[Local calibration and filtering]
    B --> C[Immediate input feedback]
    B --> D[Normalized intents over WSS]
    D --> E[Server validation and seat checks]
    E --> F[Pure rules and authoritative state]
    F --> G[Applied-state acknowledgements]
    F --> H[Public snapshots and events]
    H --> I[Client interpolation, canvas and DOM]
```

## 3. Schema structure

These are logical records, not SQL tables or a commitment to a serialization library. Names and wire shapes are proposed. Persist neither rooms nor matches; discard their data at expiry or restart. Never transmit raw motion or reconnect tokens in public snapshots, links, QR codes, or diagnostics.

### 3.1 Types and ownership

| Type | Values / constraints |
| --- | --- |
| `TeamId` | `comet` or `nova`. |
| `Role` | `pilot` or `engineer`. |
| `SeatId` | The fixed four combinations of team and role; never arbitrary additional seats. |
| `Ability` | `boost` or `shield`; each crew starts with `boost` selected. |
| `RoomPhase` | `lobby`, `countdown`, `running`, `paused`, `resuming`, `results`, `interrupted`. |
| `ParticipantId`, `MatchId`, `CoreId` | Server-issued temporary identifiers, scoped to the live room/match as appropriate. No account identity. |
| `RoomCode` | Six uppercase characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Public locator, never a seat credential. |
| `Vector2` | Finite numeric `x`, `y` in the PRD Section 4 logical 600 × 800 arena. |
| `Steering` | Finite numeric value clamped to `[-1, 1]` by the server; neutral is `0`. |
| `Sequence` | Bounded integer for matching an input to its acknowledgement and suppressing replay on its connection. |

### 3.2 Server-private room and connection records

| Record | Fields | Invariants |
| --- | --- | --- |
| `RoomState` | `code`, `phase`, `hostParticipantId`, `participants`, `seats`, optional `match`, `lastActivityRealMs` | Exactly four available seat slots; at most four occupants. One room owns its temporary data. |
| `ParticipantState` | `id`, `displayName`, `joinIntent: play/watch`, optional active `connectionId`, `lastHeartbeatRealMs` | Name is NFC-normalized, trimmed, and 1–16 graphemes; render it as text. Watching participants cannot claim seats or send gameplay inputs. Unseated play participants may choose an open role. |
| `SeatState` | `id`, optional `occupantId`, `setupStatus`, `ready`, private `reconnectToken`, optional `reconnectDeadlineRealMs` | At most one occupant per seat and one seat per participant. One active connection per occupied seat. Rotate token on a role swap and keep a reconnect deadline until usable controls return. |
| `ConnectionState` | `id`, optional bound room/participant/seat, input sequence tracking, rate-limit counters | Socket membership, not a client-supplied team/role, determines authority. Private state is never serialized into public views. |

`setupStatus` distinguishes unverified, readings confirmed, and calibrated. It reflects client-reported setup progress; it is not cryptographic proof of physical motion. The honest client cannot report successful setup or enable Ready without usable readings and calibration. The server still checks membership, connection state, setup status, and readiness before starting. Sensor spoofing remains outside the MVP's anti-cheat scope (PRD Section 10).

Seat ownership is the source of truth for team/role lookup. Host status grants start/rematch controls, not permission to control another seat. If the host leaves Results/lobby, give control to the longest-connected seated player. Two teammate taps authorize an intra-crew swap; rotate both tokens and require new-role setup and practice before Ready.

### 3.3 Authoritative match records

| Record | Fields | Invariants |
| --- | --- | --- |
| `MatchState` | `id`, `tick`, `elapsedMatchMs`, `countdownRemainingMs`, starting lane assignment, `crews`, `courseCores`, `droppedCores`, optional `result` | Two crews, one course. Gameplay time advances only while running. No scoring after the match deadline. |
| `CrewState` | `team`, `rocket`, `validCheckpointCrossings`, `carriedCores`, `energy`, `nextChargeAtMatchMs`, `abilityState`, `selectedAbility` | `selectedAbility` starts as `boost`. Carried cores in `0..5`, energy in `0..100`. Totals are derived, not independently mutable fields. |
| `RocketState` | `position`, `heading`, current movement state needed by the chosen physics, normalized pilot steering | Server-only movement decisions. The simulation retains the previous step's position for gate crossing/collision detection. Neutral input preserves heading. |
| `AbilityState` | optional active ability, `effectEndsAtMatchMs`, `cooldownEndsAtMatchMs`, `boostDropUsed` | One shared cooldown. A new boost resets its one-drop allowance. Failure spends nothing. Shield blocks core drops and reduces bumps, not walls. |
| `CourseCoreState` | `id`, fixed spawn reference, optional `respawnAtMatchMs` | Available or waiting to respawn. At capacity, collection does not consume the core or start a respawn. |
| `DroppedCoreState` | `id`, `position`, `originalOwner`, `ownerUnlockAtMatchMs`, `expiresAtMatchMs` | Either crew can collect once; original owner is locked out for the first second. Remove on pickup or expiry. |
| `MatchResult` | `outcome: win/draw/interrupted`, optional `winnerTeam`, frozen per-team breakdown | Winner exists only for a completed unequal-score match. Draw and interruption have no winner. |
| `ScoreBreakdown` | `validCheckpointCrossings`, `checkpointPoints`, `carriedCores`, `corePoints`, `total` | `total = 25 * validCheckpointCrossings + 10 * carriedCores`; no lap bonus. |

The next checkpoint derives from valid crossings modulo the four ordered gates. Accept a crossing only when it is the expected gate and the swept movement is forward through that gate. Keep prior crossing state if geometry needs it to avoid jitter at the line; do not award points merely for touching a gate. Use the exact gate, wall, lane, and core-spawn values in PRD Section 4 as named shared constants.

Compute score and breakdown from crossings and currently held cores using shared constants. A core loss changes only the core contribution. Keep the completed result fixed while the results screen is open.

### 3.4 Clock domains and transitions

| Clock | Runs during a pause? | Uses |
| --- | --- | --- |
| Server monotonic real time | Yes | Heartbeat detection, 15-second reconnect holds, room inactivity expiry, network limits, start/resume countdowns. |
| Server match time | No | 90-second match, physics, charge/ability cooldowns, active effects, respawns, dropped-core reclaim and expiry. |
| Client local time | Yes | Input feedback, interpolation, and send-to-applied-ack measurement; never authoritative gameplay decisions. |

Use remaining durations when exposing server deadlines to clients; do not require synchronized device clocks. Score only events at match time below 90 seconds. Disconnection wins an exact tie with the match deadline. Process due core timers, validated ability requests, movement/gates, collisions/drops, then pickups within an ordinary pre-deadline step. A newly dropped core waits until the next step.

```text
lobby -> countdown -> running -> results
                         |
                         v
                       paused -> resuming -> running
                         |
                         v
                    interrupted -> lobby

results -> rematch setup/readiness -> countdown
```

Start requires all four seats connected, calibrated, and ready. A disconnect during the initial countdown returns to the lobby. In a running match, disconnect/heartbeat timeout freezes gameplay and clears stale steering. Each lost seat gets its own 15-second deadline. Resume requires all four connected with usable controls and a fresh three-second countdown; another disconnect cancels that countdown. An expired deadline interrupts with no winner. The Interrupted screen offers Back to lobby. Host Rematch creates a fresh, unready lobby; every subsequent match alternates starting lanes while respecting role swaps.

### 3.5 Client-local records

| Record | Fields / purpose | Never authoritative for |
| --- | --- | --- |
| `MotionSetup` | Permission outcome, usable-reading flag, neutral calibration, latest filter state, current orientation | Membership, match readiness validation on the server, physics. Raw samples remain transient on this client. |
| `ControlState` | Normalized steering, shake detector/cooldown, last acknowledged selected ability, pending stable tilt, shake-selection lock | Energy, cooldown completion, successful activation. Local selection feedback precedes server acknowledgement. |
| `PracticeState` | Ghost movement, ring progress, practice-only energy/ability state | Any live match score, energy, or pickup. |
| `ClientSession` | Own participant/seat, private reconnect credential, local screen, latest public room state | Other seats or host privileges. Never share its token via URLs or logs. |
| `RenderState` | Small snapshot buffer, interpolation progress, transient feedback events | Collision, checkpoint, pickup, or result decisions. |
| `PendingInput` | Sequence and local send time until the matching applied/rejected acknowledgement | Server time or admission decisions. |

On rotation, show "Turn your phone upright", send neutral pilot steering, and block engineer selection changes. Do not rely on orientation lock. Recalibration is available before play and during a connection pause. Do not upload calibration angles, accelerometer vectors, compass headings, or motion histories.

### 3.6 WebSocket contract

All room operations, input, acknowledgements, and live state use WSS. These proposed message names describe responsibilities; finalize serialization with the chosen stack. Client gameplay messages carry `matchId` and `sequence`, with authority derived from the authenticated connection. Lobby/control messages carry a small request identifier where a response needs correlation.

| Client message | Payload | Server checks |
| --- | --- | --- |
| `room.create` | Display name | Name limit; creation rate; origin and size. |
| `room.join` | Room code, display name, intent to play/watch | Room exists; name limit. A full room offers Watch without evicting a player. |
| `seat.claim` | Requested team and role | Lobby eligibility; open slot; participant is not watching or already occupying another seat. |
| `room.leave` | No gameplay payload | Release/connection handling and lobby host transfer as applicable. |
| `setup.update` | Readings-confirmed/calibrated status only | Own occupied seat; allowed phase; no raw readings. |
| `ready.set` | Boolean ready status | Own seat, connection and setup eligibility. |
| `match.start` | No match state | Host and all four start requirements. |
| `seat.reconnect` | Room code, seat ID, private reconnect token | Token matches held seat; hold not expired; enforce one active connection. Never accept room code alone. |
| `input.steer` | Match ID, sequence, normalized steering | Current match, running phase, Pilot ownership, finite number; clamp range. |
| `input.charge` | Match ID, sequence | Current match, running phase, Engineer ownership, charge frequency and energy cap. |
| `ability.request` | Match ID, sequence, `intent: select` plus ability, or `intent: activate` without client-chosen ability | Current match, running phase, Engineer ownership. Select updates server-owned crew choice at no cost; activate uses that choice after energy/cooldown checks. |
| `match.rematch` | No score/reset payload | Host only, Results phase. Fresh match, cleared Ready states, alternating lanes. |
| `match.swap` | Own crew's swap intent | Results phase, one consent per teammate. Apply only after both consent; rotate seat tokens and clear both setup/Ready states. |
| `heartbeat` | Minimal liveness/correlation data, sent once per second | Bound connection; server records reception time and pauses after three seconds without it. |

| Server message / public projection | Fields and intended use |
| --- | --- |
| `session.accepted` | Own participant/seat and reconnect token, sent privately only to that participant. |
| `room.state` | Code, phase, host identity, public names/roles, connection/setup/ready states, available seats. No token, socket handle, raw readings, or limiter state. |
| `match.state` | Match ID/tick, phase, elapsed/remaining time, public crew state, core states, active effect/cooldown durations, countdown/reconnect remaining time. Derived scores and next gates may be included for UI convenience. |
| `input.ack` | Match ID, sequence, accepted/rejected status, reason when rejected, application tick and resulting relevant state when accepted. A steering ack includes applied steering/movement state; charge/activation acks include resulting energy/ability state. |
| `match.events` | Short-lived checkpoint, pickup, drop/block, ability, wall/bump and end events, with enough identity to avoid replaying visual feedback. Can accompany the snapshot; no persistent event log. |
| `match.result` | Frozen win/draw breakdown or Interrupted with no winner. All clients receive the same result. |
| `request.rejected` / room error | Correlated reason and recovery action: unavailable seat, missing setup, denied start, expiry/restart, etc. Use PRD copy where defined; agree missing copy before shipping. |

Validation occurs before any mutation: 1024-byte client limit, text JSON parse/type, allowed fields, bounded strings/numbers, finite values, allowed message type, connection membership, phase, sequence/match freshness, and PRD Section 8 rate limits. Reject unauthorized inputs without changing state. The server must suppress duplicate charge/activation processing and reject stale inputs after a rematch/reconnect. Apply transport limits separately from the gameplay charge limit. Only accepted room actions and gameplay input refresh room inactivity; heartbeat alone does not.

The latency target is measured from the client's send time to an acknowledgement of **applied state**, not just socket receipt. Record timings/errors without display names, tokens, identifying connection data, or raw sensor data. Measure rendering delay separately.

### 3.7 Shared constants and design tokens

The values below come from PRD v1.2; they are playtest starting values. Put gameplay, sensor, course, and transport numbers in `shared/config.ts` as named constants and use them in rules, validation, tutorial, and results. Course geometry and spawn data in `shared/course.ts` refer to those constants rather than duplicating numbers. Tune motion/physics values after physical-device measurements and update the PRD and both explanations when a rule changes.

| Named constants | PRD values |
| --- | --- |
| `ACTIVE_PLAYERS`, `TEAM_COUNT`, `ROLES_PER_TEAM`, `CHECKPOINT_COUNT` | `4`, `2`, `2`, `4` |
| `MATCH_DURATION_MS`, `COUNTDOWN_MS`, `RESUME_COUNTDOWN_MS` | `90000`, `3000`, `3000` |
| `CHECKPOINT_POINTS`, `CORE_POINTS`, `MAX_CARRIED_CORES` | `25`, `10`, `5` |
| `COURSE_CORE_RESPAWN_MS`, `DROPPED_CORE_LIFETIME_MS`, `OWNER_RECLAIM_DELAY_MS` | `8000`, `6000`, `1000` |
| `INITIAL_ENERGY`, `MAX_ENERGY`, `CHARGE_ENERGY`, `CHARGE_INTERVAL_MS` | `50`, `100`, `25`, `1000` |
| `ABILITY_COST`, `ABILITY_DURATION_MS`, `SHARED_COOLDOWN_MS`, `MAX_DROPS_PER_BOOST` | `50`, `2000`, `3000`, `1` |
| `HEARTBEAT_TIMEOUT_MS`, `SEAT_HOLD_MS`, `ROOM_INACTIVITY_MS` | `3000`, `15000`, `1800000` |
| `SENSOR_READINGS_TIMEOUT_MS`, `CALIBRATION_HOLD_MS` | `3000`, `1000` |
| `SIMULATION_HZ`, `BROADCAST_HZ` | Initial `30`, `18`; adjust only from measurement. |
| `CALIBRATION_STABILITY_DEG`, `TILT_DEAD_ZONE_DEG`, `TILT_FULL_SCALE_DEG`, `TILT_SMOOTHING_TAU_MS` | `4`, `4`, `28`, `80` |
| `SENSOR_CHECK_MIN_READINGS`, `SENSOR_CHECK_TILT_SPAN_DEG` | `3`, `2` |
| `SELECTION_TILT_DEG`, `SELECTION_HOLD_MS`, `SHAKE_QUIET_MS` | `12`, `300`, `300` |
| `SHAKE_PEAK_ACCEL_MPS2`, `SHAKE_MIN_PEAK_GAP_MS`, `SHAKE_MAX_PEAK_GAP_MS`, `SHAKE_GRAVITY_TAU_MS` | `12`, `80`, `450`, `500` |
| `COURSE_WIDTH`, `COURSE_HEIGHT`, `ROCKET_LENGTH`, `ROCKET_RADIUS`, `CORE_DIAMETER`, `CORE_PICKUP_RADIUS` | `600`, `800`, `48`, `18`, `26`, `31` |
| `BASE_SPEED`, `MAX_TURN_DEG_PER_SEC`, `BOOST_SPEED_MULTIPLIER`, `WALL_SPEED_MULTIPLIER`, `WALL_SLOW_MS` | `120`, `120`, `1.5`, `0.6`, `400` |
| `BUMP_DISPLACEMENT`, `SHIELD_BUMP_MULTIPLIER` | `12`, `0.25` |
| `OUTER_TRACK`, `INNER_TRACK`, `GATES`, `START_LANES`, `CORE_SPAWNS` | Named coordinate/radius data from PRD Section 4. |
| `DISPLAY_NAME_MAX_GRAPHEMES`, `ROOM_CODE_LENGTH`, `CLIENT_MESSAGE_MAX_BYTES`, `RECONNECT_TOKEN_MIN_BITS` | `16`, `6`, `1024`, `128` |
| `HEARTBEAT_INTERVAL_MS`, `CLIENT_STEERING_HZ`, `SERVER_STEERING_PER_SEC`, `ABILITY_REQUESTS_PER_SEC`, `SOCKET_MESSAGES_PER_SEC` | `1000`, `20`, `30`, `5`, `40` |
| `ROOM_CREATES_PER_MIN_PER_IP`, `ROOM_JOINS_PER_MIN_PER_IP` | `5`, `10` |

`design-tokens.ts` owns the exact Section 7.3 palette, team glyphs/shapes/trails, typography, spacing, sizing, and UI timing values. Expose its color values as CSS custom properties and use the same source for canvas. Do not maintain a second handwritten palette.

Carry the Section 7 requirements through implementation: Space Grotesk 500/700 and Inter 400/600, self-hosted with swap and system fallback; tabular numbers; 48 px targets/8 px gaps; 96 px Activate; portrait HUD/arena/panel proportions about 12/58/30; minimum rocket/core sizes 28/14 CSS px; five-second own-team tag and pilot hint; warning timer in final ten seconds; device pixel ratio capped at 2. Use named tokens for the remaining Section 7.8 feedback timings as well.

Targets to measure, not advertise as achieved: about 100 KB of fonts, under about 500 KB compressed initial load, 60 fps, and p95 applied-ack latency at most 150 ms on the demo network.

## 4. Step-by-step task breakdown

Complete milestones in PRD Section 12 order. Basic security, accessible controls, and truthful readiness belong in the first implementation of each boundary; M4 expands interruption handling and validation coverage rather than postponing those safeguards.

All tasks below are pending. Within a milestone, follow the listed order unless the task explicitly depends on a later decision. Each milestone depends on the previous exit gate. Read affected PRD sections before coding; run the actual project build and lint after every change, plus focused tests for the affected logic. Update callers, schema consumers, fixtures, tutorial, and results together when a rule changes.

### M1. Prove the controls — feasibility gate

References: Sections 5, 6, 7.6-7.11, 9, 12. Acceptance criteria: groundwork for AC3, AC4, AC12, AC13.

| Task | Implementation scope | Completion evidence |
| --- | --- | --- |
| [ ] 1.1 Scaffold the selected minimum stack | Use resolved D1 and confirm it with the user before scaffolding, per AGENTS.md. Pin compatible exact Node/package versions; add the single manifest/lockfile, typecheck/build/lint/test commands, app entry, basic tokens and portrait layout. Document deploying one Render Web Service (configured by `render.yaml`) that serves the built sensor-test client and `/healthz` over HTTPS; no game logic or WebSockets before the physical-device gate passes. | Build and lint run; sensor page opens through HTTPS on both intended platforms. No game logic, WebSocket server, detailed art, or gameplay expansion. |
| [ ] 1.2 Implement permission and reading checks | `sensors`, motion setup, status UI. Request permission directly from Enable motion; feature-detect APIs. Show live usable readings, a three-second no-data error, retry, and Watch recovery where available. | Denial, missing data, and success have distinct states. Neither permission approval alone nor simulated data can qualify as verified motion setup. |
| [ ] 1.3 Calibrate and normalize pilot tilt | Use PRD Section 5 gamma mapping and playtest thresholds: local per-player neutral, one-second hold UI, dead zone, smoothing and cap. Add rotation overlay and neutral steering output. | Real left/right movement is correct and comfortable on iPhone and Android; record any tuning and update the PRD. Small tests cover finite/capped output and relative neutral. |
| [ ] 1.4 Implement engineer motion visualization | Use PRD Section 5 shake filtering, two-peak gesture, quiet interval, selection hold/lock, and same-frame feedback in the sensor test. | Focused tests cover selection lock and burst behavior. Physical shake does not switch abilities accidentally. Full role practice waits for M3. |
| [ ] 1.5 Run and record the hardware gate | Actual iPhone Safari and Android Chrome, exact device/OS/browser versions. Exercise permission deny/retry/no-data, calibration, grip comfort, shake, rotation, background/foreground. Record observations without motion streams or identifying data. | Usable real readings on both platforms and a confirmed common orientation. Resolve control failures before proceeding. Simulators do not pass this gate. |

**Exit:** a deployed sensor test works on the intended iPhone and Android phones. This is not yet a playable four-person game or a device-support claim.

### M2. Prove shared control

References: Sections 5, 7.6, 8-10, 12. Acceptance criteria: groundwork for AC2, AC4, AC5, AC11, AC12.

| Task | Implementation scope | Completion evidence |
| --- | --- | --- |
| [ ] 2.1 Define contracts, limits, and one in-memory room flow | Use PRD Section 8 limits and server-owned ability selection. Implement public/private schemas, create/join, four fixed seat slots, host identity, code/link/QR sharing, unique role claims, tokens and inactivity expiry. | Seat tests reject duplicates and spectator gameplay. A token never appears in room state or a shared link. No persistence layer. |
| [ ] 2.2 Connect secure transport with validation | Add the Express/`ws` server and server build, then deploy one paid Render Web Service for the client and WSS. Implement origin allowlist, message/creation/input limits, per-message membership checks, normalized controls, heartbeat, sequenced applied-state acks. Provide clear room errors. | Transport tests cover malformed/oversized/non-finite values, wrong roles, bad origins, replay and stale match input. Invalid requests leave state unchanged. One live process owns all room state. |
| [ ] 2.3 Connect one rocket to two roles | Use PRD Section 4 movement settings. Pure movement/ability rules, fixed server step at initial 30 Hz, broadcasts at initial 18 Hz, synchronized crew energy, selected ability and effect state. Render interpolated movement and DOM role status; reuse the arena without controls for Watch recovery. | One pilot and one engineer control the same rocket on two real phones. Charge cap/frequency, selected ability visibility, ability cost/duration/shared cooldown pass small tests. Watch requires neither a seat nor motion setup. |
| [ ] 2.4 Measure shared control | Immediate local feedback, authoritative energy updates, server applied-state acks, transient timing measurement; confirm privacy of diagnostics. | Record p95 send-to-applied-ack latency separately from rendering delay. Report results against the target without treating target values as measurements. |

**Exit:** two phones reliably share control of one rocket. This is an internal development proof; it must not enable a competitive match with fewer than four players. No special public two-player game mode is added.

### M3. Complete the game loop

References: Sections 3-7, 8, 11-12. Acceptance criteria: AC1-AC8 foundations, AC11-AC13 foundations.

| Task | Implementation scope | Completion evidence |
| --- | --- | --- |
| [ ] 3.1 Add the second crew and one course | Build the sole PRD Section 4 rounded-ring course with its fixed gate/core coordinates, clockwise route, equal-progress spawns, wall slowdown/containment and ordinary bumps. | Pure physics checks cover wall containment and non-damaging ordinary bumps. Every phone displays the entire uncropped course. |
| [ ] 3.2 Implement ordered scoring | Server swept crossing checks, next gate, laps without bonus, derived totals and checkpoint feedback. | Forward/order tests include backward, repeated, skipped, and lap-wrap crossings. No path can subtract checkpoint points. |
| [ ] 3.3 Implement pickups and combat interaction | Five-core cap, eight-second respawns, boosted ram one-drop allowance, shield protection, one-second owner lockout, six-second dropped-core expiry and PRD Section 4 collision/pickup order. | Boundary/ownership tests cover both crews collecting, full inventory, shield, repeated contacts in one boost, and exact simultaneous pickup. Snapshot ownership and score agree. |
| [ ] 3.4 Add the timed four-player match and results | Four connected/calibrated/ready seats required; three-second countdown, 90-second authoritative stop, win/draw, frozen breakdown and results screen. Practice stays isolated. | Match tests cover deadline, tie, breakdown arithmetic, and no input/scoring after completion. All four devices show the same result. |
| [ ] 3.5 Complete practice and the playable phone flow | Home/join/lobby/setup/practice/countdown/match/results; HUD scores/timer/pips, pilot gauge and crew status, engineer energy/selection/cooldown/failure reason. Pilot practice: ghost through three rings (~10 s). Engineer practice: fill two segments, select Shield, activate. Show PRACTICE and Skip after first success; isolate practice state. | Four real phones complete a match with both pilots tilting and both engineers shaking. Practice cannot affect match scores/energy. Start failures explain the reason; controls are readable; rotation sends neutral and locks selection. |

**Exit:** a complete four-person match works. Keep visuals functional; detailed effects wait for M5. Basic readiness and validation are already enforced.

### M4. Handle interruptions

References: Sections 6-10, 11-12. Acceptance criteria: AC2, AC3, AC9-AC11; regression checks for AC4-AC8.

| Task | Implementation scope | Completion evidence |
| --- | --- | --- |
| [ ] 4.1 Finish readiness and ownership failure paths | Exercise three players, duplicate seats, unready/uncalibrated/disconnected players, full-room Watch offer, host departure in lobby, unauthorized role inputs. | Every blocked action explains recovery. Server checks are independent of disabled client buttons. Missing sensor data never counts as ready. |
| [ ] 4.2 Freeze and restore matches correctly | Visible disconnect or three-second heartbeat timeout; clear stale steering; freeze physics, match clock, cooldowns, effects and pickup timers. Enforce separate 15-second seat deadlines, private reconnect with usable controls and fresh three-second resume countdown. | Fake-time tests cover a second disconnect, reset resume countdown, and no gameplay timer advancement while paused/resuming. Physical disconnect/backgrounding tests restore the correct seat with one active connection. |
| [ ] 4.3 Implement interruption and room lifecycle | Hold expiry -> Interrupted without winner; Back to lobby. Recalibration while paused. Room inactivity expiry and clear restart/room-missing recovery. | Long disconnect, expiry, and server restart show actionable UI. Wrong/expired reconnect tokens cannot reclaim a seat. No stale state resumes a completed/interrupted match. |
| [ ] 4.4 Implement rematch and role swaps | Implement PRD Section 8 host Rematch and two-teammate Swap roles. Reset scores, cores/locations, energy, timers, selected/active ability state and Ready; alternate lanes. Recheck/calibrate/practice new roles, rotate tokens and reapply four-player eligibility. | Reset tests compare against fresh initial state plus lane alternation/role assignment. Old-match inputs and old seat credentials cannot affect the new match. |
| [ ] 4.5 Run recovery and abuse regression | Extend existing tests; no separate test framework. Try duplicate connections, stale/replayed actions, invalid names and input floods. Test initial countdown abort, exact match deadline/disconnect ordering and each seat's timeout. Repeat real-device rotation/background/reconnect paths. | AC2, AC9-AC11 pass on the implementation; physical recovery results are recorded separately from automated tests. |

**Exit:** interruptions and failure paths behave as specified without corrupting scores, ownership, or timers.

### M5. Prepare the presentation

References: Sections 2, 6-7, 11-12, 14-15. Acceptance criteria: final validation of AC1-AC13.

| Task | Implementation scope | Completion evidence |
| --- | --- | --- |
| [ ] 5.1 Finish the specified visual system | Exact palette, Comet arrow/chevrons/triangle vs Nova capsule/dots/circle, labels/halos, self-hosted fonts, typography, code-drawn 2D art. DOM HUD, portrait layout, safe areas and target sizes. | Grayscale and contrast checks; menu at 200% text size; full arena visible without match scrolling. Fonts and colors share their declared sources. |
| [ ] 5.2 Finish feedback and accessibility | Section 7.8 events, selection hold/lock, cooldown and failures, first-five-second hints, final-ten-second timer, local input feedback. Honor reduced motion; no phone screen/camera shake. Polite live regions for lobby/results; assertive for pauses/errors. | Every necessary event is visible. Animations never delay input or authoritative state. Optional sound has mute and user-tap unlock; haptics are feature-detected. |
| [ ] 5.3 Add the optional spectator presentation | Read-only 16:9 view, both next gates, crew names/roles, score/core/energy/ability panels, large timer and event ticker. Reuse the same public snapshots. | A fifth device can watch without taking a seat or sending gameplay input; evaluate readability at about 4 m. If this dedicated layout is omitted, retain the shared Watch view and record the demo limitation. |
| [ ] 5.4 Validate rendering and delivery | DPR cap 2, letterboxing/refit, pre-rendered glow rather than per-frame shadow blur, shed effects before interpolation. Feature-detect wake lock and reacquire when visible. Measure payload and frame behavior. | Record initial compressed bytes, font bytes, observed frame rate, and latency on actual phones/network against targets. No unmeasured performance/device claims. |
| [ ] 5.5 Run the release checklist and rehearse | Concise role tutorials and results math stay aligned with shared rules/PRD. Run all AC checks, three consecutive 90-second matches with four physical phones including iPhone and Android, plus the demo story. | Device log records outcomes, failures and fixes. Observe both abilities and crew coordination. Check entry within two minutes for at least 4/5 groups and role understanding for at least 4/5 first-time players, or explicitly mark those studies unrun. |

**Exit:** three consecutive matches complete on the actual demonstration setup, every required acceptance criterion passes, and remaining optional omissions and unmeasured success targets are stated explicitly.

## 5. Acceptance and test map

`ACn` refers to PRD Section 11, item n. Automated checks support the criteria; they do not substitute for the required physical-device evidence.

| Criterion | Main tasks | Small automated checks | Required manual / device evidence |
| --- | --- | --- | --- |
| AC1: four phones and optional spectator | 3.5, 5.3, 5.5 | Seat count and spectator permissions | Deployed four-phone match; fifth-device Watch check, plus dedicated spectator layout if included. |
| AC2: invalid starts blocked | 2.1, 3.4, 4.1 | Missing/duplicate/unready/disconnected/uncalibrated seats | Specific start-blocked reason visible. |
| AC3: real motion readiness | 1.2-1.5, 4.1 | Setup/ready transitions reject missing readings | Physical tilt/shake; denied permission and absent data. |
| AC4: charge and selection safety | 1.4, 2.3 | Selection lock, stable hold, one charge per second | Real shaking does not switch abilities. |
| AC5: ability limits and consistency | 2.3, 3.3 | Cost 50, effect 2 s, cooldown 3 s; failed attempts unchanged | Consistent effects and failures on all devices. |
| AC6: valid gate order | 3.2 | Forward/order/repeat/skip/lap-wrap cases | Course/gate direction readable during play. |
| AC7: cores and boosted rams | 3.3 | At most one drop per boost; shield; capacity; reclaim/expiry/respawn | All clients agree on ownership and score changes. |
| AC8: end/result/draw | 3.4 | 90-second boundary, score breakdown, tie | Same result on every device. |
| AC9: pause/reconnect/interruption | 4.2, 4.3, 4.5 | Frozen timers; independent holds; second disconnect; initial/resume countdown abort; no-winner interruption | Network loss, backgrounding, resume countdown. |
| AC10: rematch | 4.4 | Reset every match field; alternate lanes; two-person swap consent, renewed setup and tokens | Repeat play with role swaps. |
| AC11: invalid/unauthorized messages | 2.2, 4.5 | Origin/size/range/role/token/rate/replay rejection | Connection/expiry errors give recovery paths. |
| AC12: readable/responsive | 1.5, 2.4, 5.4, 5.5 | No automated substitute for the device target | Presentation phones, input-to-applied-ack p95, rendering separately. |
| AC13: redundant identity and UI states | 5.1, 5.2 | Focused UI state assertions if useful | Grayscale, measured contrast, selection lock, cooldown and failed-activation reasons. |

For `device-test-log.md`, record: build/revision, test date, device model, OS/browser versions, network description without identifying data, scenario/AC, observed result, measured timing where applicable, and follow-up. Do not record participant names, device identifiers, reconnect credentials, or raw sensor samples.

## 6. Current verification status

- Read the PRD and project rules; checked the proposed scope against all five milestones and thirteen acceptance criteria.
- D1-D7 are resolved as initial specification decisions in PRD v1.2 and this plan; D1 remains recorded in AGENTS.md. The proposed tree names the selected tools; no application scaffolding, installed dependencies, schema implementation, or paid service were created.
- Build, lint, and automated tests cannot run yet: the repository has no executable project or commands. Add and run them in task 1.1.
- No physical-device, accessibility, latency, frame-rate, payload-size, or playtest target has been validated by this planning work.
- The next implementation step is task 1.1 with the selected D1 stack. D2 hardware behavior and D4 gameplay balance remain unvalidated. Do not bypass the M1 hardware gate.

# Implementation Plan: M3 Game Loop

## Overview

Build M3 in TypeScript on the verified M2 code: shared constants and contracts first, then the pure course, movement, scoring, collision, pickup, and match rules with property tests, then Ready/start and the server match runtime, then the client data layer, rendering, and screens, and finally the PRD copy, device log, and verification.

Rules for every task:

- Read the PRD sections and design sections each task names before coding. Follow `AGENTS.md`; the PRD wins.
- Every gameplay number comes from `src/shared/config.ts`; UI sizes and timings from `src/shared/tokens.ts`; drawing proportions are named constants in `arena-geometry.ts`. No inline numbers.
- Rules stay pure: state, inputs, and time in; new state out. No clock, random source, socket, or DOM inside `src/shared/**`.
- The server validates type, size, ranges, membership, role, phase, and host before any mutation. Public messages stay allowlisted.
- Run `npm run lint`, `npm test`, and `npm run build` after each task and fix failures before finishing it. If a change breaks an existing M2 test, update that test in the same task.
- Do not commit, push, or change the plan in `render.yaml`. Do not build M4/M5 features: resume countdown, Interrupted phase or screen, rematch, role swaps, lane alternation, event bursts, sound, the 16:9 spectator layout.
- Agents cannot test on phones. Say so in each report; the M3 exit (a complete four-person match on four real phones) is a manual check in `docs/device-test-log.md`.

## Status (audit, October 25, 2026)

The M3 code was written outside this checklist; this audit compared each task with the uncommitted working tree. Checked tasks are implemented. Unchecked tasks carry a **Partial** or **Not done** note. Lint, 304 tests in 37 files, and the build passed at the audit.

- **Screen decision:** `control-screen.ts` serves both the dev control test and the match (design M3-15, revised). There is no `match-screen.ts` or `crew-controls.ts`; tasks 11.1 and 11.3 are rewritten to match.
- **Open gap that matters:** `server/simulation.ts` does not catch exceptions thrown by a match step (task 7.1). The loop runs inside a `setInterval` in `server/websocket.ts`, so a thrown step would be an uncaught exception and end the Node process with every room.
- **Test coverage:** most optional property tasks are covered only by example tests (in `course.test.ts`, `rules/match.test.ts`, `rules/pickups.test.ts`, `server/match.test.ts`, `client/flow.test.ts`) or not at all. None carry the `m3-game-loop` property tags. The four-client integration test (7.8) exists.

## Tasks

- [x] 1. Add shared constants and contracts
  - [x] 1.1 Extend `src/shared/config.ts` and `src/shared/tokens.ts`
    - Add the design Constants table: `OUTER_WALL`, `INNER_WALL`, `GATE_SEGMENTS`, `CHECKPOINT_COUNT`, `CHECKPOINT_POINTS`, `CORE_POINTS`, `CORE_SPAWNS`, `CORE_DIAMETER`, `CORE_PICKUP_RADIUS`, `MAX_CARRIED_CORES`, `COURSE_CORE_RESPAWN_MS`, `DROPPED_CORE_LIFETIME_MS`, `OWNER_RECLAIM_DELAY_MS`, `WALL_SPEED_MULTIPLIER`, `WALL_SLOW_MS`, `BUMP_DISPLACEMENT`, `SHIELD_BUMP_MULTIPLIER`, `MAX_DROPS_PER_BOOST`, `MATCH_DURATION_MS`, `START_COUNTDOWN_MS`, and the M3 practice values, each with a short "why" comment and PRD reference
    - Tokens: `MIN_CORE_CSS_PX`, `FINAL_WARNING_MS`, `YOU_TAG_MS`, `COUNTDOWN_NUMERAL_MS`, `EDGE_MARKER_SIZE_PX`, `EDGE_MARKER_INSET_PX`, `OWN_HALO_PX`
    - Note: `EDGE_MARKER_SIZE_PX` is 16, not the design's 20.
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ]* 1.2 Write unit tests for the M3 constants
    - Assert every PRD value from Requirement 1.1 (including gate coordinates and directions) and the token values
    - **Not done:** no M3 config or token value test.
    - _Requirements: 1.1, 1.2, 1.3, 6.1_
  - [x] 1.3 Extend `src/shared/protocol.ts` and keep every consumer compiling
    - Add `RoomPhase`, `ReturnReason`, `StartStep`, `StartBlocker`, `PublicScoreBreakdown`, `ready.set`, `match.start`, the new reject reasons, `PublicSeat.ready`, `RoomStateMessage.phase/result/returnReason`, `MatchSnapshotMessage` and its public types; rename the control-test snapshot to `ControlTestStateMessage` and make `MatchStateMessage` a union on `mode`; keep `match.rematch` and `match.swap` absent
    - `server/validate.ts`: real schemas for `ready.set` (boolean `ready`, else `invalid-value`) and `match.start`
    - Temporary, replaced later: `server/dispatch.ts` refuses `ready.set` and `match.start` with `wrong-phase` (task 7.4); `server/public-view.ts` emits `phase: 'lobby'`, `ready: false`, `result: null`, `returnReason: null` (task 6.7); `src/client/ui/copy.ts` maps new reasons to the developer-only marker (task 9.8); client screens narrow `match.state` on `mode === 'control-test'`
    - _Requirements: 15.1, 15.2, 15.3, 16.1, 16.2, 16.3_

- [x] 2. Implement the course and movement on it
  - [x] 2.1 Implement `src/shared/course.ts`
    - `signedDistance` and `gradient` for rounded rectangles (deterministic tie at the center), `isDrivable`, `containPoint`, `containPose` with the start-lane fallback for non-finite coordinates and the clockwise-tangent redirect for headings into the wall, `GATES` built from `GATE_SEGMENTS`, `crossesForward` with `s(from) ≤ 0 < s(to)` and the inclusive span
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 6.1_
  - [x]* 2.2 Write property test for containment
    - **Property 1: Containment keeps rocket centers on the course**
    - Covered by the fast-check test in `src/shared/course.test.ts` (untagged).
    - **Validates: Requirements 2.1, 2.2, 2.6, 2.7**
  - [x]* 2.3 Write property test for containment idempotence
    - **Property 2: Containment is idempotent**
    - Covered by the same fast-check test in `src/shared/course.test.ts` (untagged).
    - **Validates: Requirements 2.8**
  - [ ]* 2.4 Write property test for wall redirects
    - **Property 3: Wall contacts redirect only headings into the wall**
    - **Partial:** example test in `course.test.ts` only.
    - **Validates: Requirements 2.3, 2.4**
  - [x] 2.5 Replace the arena clamp in `src/shared/rules/physics.ts` and fly the control test on the course
    - `RocketState` with `wallSlowUntilMs`, `forwardSpeed` (wall slow wins over Boost), `turnAndMove`, `stepRocket` returning the movement segment and wall contact, `createStartPose(team, lanes)`; remove the inset-arena clamp
    - `src/shared/rules/control-test.ts`: carry `RocketState`, step on the course with wall slows; `server/public-view.ts` reads the pose from the rocket state
    - Update the M2 physics and control-test tests that assumed the clamp (M2 Properties 19 and 20)
    - Note: movement is `moveRocket`; `createStartPose(team)` has no lanes argument yet (lane alternation is M4).
    - _Requirements: 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 26.3_
  - [ ]* 2.6 Write property test for speed
    - **Property 4: Speed follows Boost and the wall slow**
    - **Partial:** example tests in `course.test.ts` and `rules/match.test.ts` only.
    - **Validates: Requirements 2.5, 3.1, 3.2, 3.3**
  - [ ]* 2.7 Write property test for turning
    - **Property 5: Turning follows steering; neutral keeps heading**
    - **Not done.**
    - **Validates: Requirements 3.4, 3.5**
  - [ ]* 2.8 Write unit tests for wall slow and the control test on the course
    - Wall slow active at 399 ms and over at 400 ms; a control-test rocket flown straight into a wall stays in the Drivable_Region and slides along the clockwise tangent
    - **Partial:** the wall-slow boundary (`course.test.ts`) and a wall slide with `moveRocket` (`physics.test.ts`) are covered; no control-test-specific wall test.
    - _Requirements: 2.5, 3.6, 26.3_

- [x] 3. Implement scoring, collisions, pickups, and the shared copy
  - [x] 3.1 Implement `src/shared/rules/scoring.ts`
    - `nextGateIndex`, `advanceCrossings` (next gate only, bounded loop, no subtraction), `teamScore`, `breakdown`, `matchResult` (win with higher total, draw on equal)
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 10.1, 10.2, 10.3, 10.4_
  - [ ]* 3.2 Write property test for gate crossings
    - **Property 9: Gate crossings match the ordered forward model**
    - **Partial:** example test in `course.test.ts` only.
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.6, 6.7**
  - [ ]* 3.3 Write property test for scores and results
    - **Property 20: Scores and results follow the formula**
    - **Partial:** example assertions in `course.test.ts` and `rules/match.test.ts` only.
    - **Validates: Requirements 6.6, 10.1, 10.2, 10.3, 10.4, 10.6**
  - [x] 3.4 Implement `src/shared/rules/collisions.ts`
    - `resolveContact` (overlap test, equal separation along the center line with a deterministic coincident case, first-contact bump of `BUMP_DISPLACEMENT` reduced by `SHIELD_BUMP_MULTIPLIER` for a shielded crew, impact midpoint) and `ramOutcome`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7, 8.1, 8.3, 8.4_
  - [ ]* 3.5 Write property test for bumps
    - **Property 7: Bumps separate and displace within limits**
    - **Partial:** example test in `rules/match.test.ts` only.
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.7**
  - [ ]* 3.6 Write property test for ram outcomes
    - **Property 14: Ram outcomes follow boost, allowance, shield, and cargo**
    - **Partial:** example assertions in `rules/match.test.ts` only.
    - **Validates: Requirements 8.1, 8.3, 8.4**
  - [x] 3.7 Implement `src/shared/rules/pickups.ts`
    - `createCourseCores`, `expireAndRespawn` (expiry and respawn at `now ≥ deadline`), `contactTime` (smallest root in [0, 1], 0 when starting inside), `resolvePickups` (eligibility, greedy by contact time with capacity, exact-tie leaves the core, creation-step exclusion, owner lockout, respawn deadline on collection)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.8, 8.9, 8.10_
  - [ ]* 3.8 Write property test for contact time
    - **Property 10: Contact time is the earliest entry into the pickup radius**
    - **Partial:** example test in `rules/pickups.test.ts` only.
    - **Validates: Requirements 7.2**
  - [ ]* 3.9 Write property test for pickups
    - **Property 11: Pickups go to the earliest eligible rocket**
    - **Partial:** example tests in `rules/pickups.test.ts` only.
    - **Validates: Requirements 7.3, 7.4, 7.5, 8.8, 8.9**
  - [x] 3.10 Implement `src/shared/copy.ts`
    - `pilotTutorial`, `engineerTutorial`, `gatesLine`, `coresLine`, `RESULTS_NOTE`, `startBlockerText`, all built from config values; define the seat-name map here (task 9.8 makes `ui/copy.ts` use it)
    - Note: the shared module has `seatLabel`; `ui/copy.ts` still keeps its own `SEAT_NAMES` map (same output).
    - _Requirements: 18.2, 18.3, 18.4, 24.3_
  - [ ]* 3.11 Write tests for the shared copy
    - **Property 32: Results lines match the breakdown**
    - **Validates: Requirements 18.4, 23.3**
    - Also an example test: with the default config, both tutorials and the results note equal the PRD Section 4 strings (Requirements 18.2, 18.3)
    - **Not done.** The audit compared the tutorials and results note with PRD Section 4 by reading; they match, but no test enforces it.

- [x] 4. Implement the pure match step
  - [x] 4.1 Implement `src/shared/rules/match.ts`
    - `matchMsAt`, `createMatch(matchId, lanes)` (both rockets, crews at 50 energy with Boost, four available cores, `comet-upper` default), `withNeutralSteering`, and `stepMatch` in the design order: expirations and respawns; inputs per team in arrival order (Boost activation resets the drop allowance); movement, containment, and gate crossings on the movement segment; contact, bump, ram drops at the projected midpoint, re-containment, and gate crossings on the collision segment; pickups on start-to-end segments; tick increment, completion and result at 90000 ms; completed states returned unchanged with every input rejected as `not-running`
    - Note: `createMatch(matchId)` takes no lanes argument and always uses `comet-upper`; M4 adds lane alternation. Neutral steering is `neutralMatchSteering`.
    - _Requirements: 1.4, 4.1, 4.2, 4.3, 4.4, 5.5, 5.6, 6.5, 6.8, 7.8, 7.9, 8.2, 8.5, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4, 9.5, 13.2, 13.3_
  - [ ]* 4.2 Write property test for the match clock in `match-clock.test.ts`
    - **Property 17: The integer match clock lands on exact boundaries**
    - **Not done** (the 90-second boundary has an example test).
    - **Validates: Requirements 9.2**
  - [ ]* 4.3 Write property test for the step shape in `match-step.test.ts`
    - **Property 18: Each match step advances one tick and answers every input**
    - **Not done.**
    - **Validates: Requirements 9.3, 9.4, 9.5**
  - [ ]* 4.4 Write property test for completed matches in `match-step.test.ts`
    - **Property 19: Completed matches never change**
    - **Partial:** example test in `rules/match.test.ts` only.
    - **Validates: Requirements 13.2, 13.4**
  - [ ]* 4.5 Write property test for step invariants in `match-invariants.test.ts`
    - **Property 8: Match steps keep rockets, gates, and cores valid**
    - **Partial:** a fast-check test in `rules/match.test.ts` covers steering-only inputs (rockets on course, crossings nondecreasing, carried 0..5); no charge, ability, or core-state generators.
    - **Validates: Requirements 5.5, 5.6, 6.8, 7.8**
  - [ ]* 4.6 Write property test for crew separation in `match-invariants.test.ts`
    - **Property 6: One crew's inputs never touch the other crew's controls**
    - **Partial:** example test in `rules/match.test.ts` only.
    - **Validates: Requirements 4.4**
  - [ ]* 4.7 Write property test for core timers in `match-cores.test.ts`
    - **Property 12: Core timers fire on the exact step**
    - **Partial:** boundary examples (999/1000, 6000, 8000 ms) in `rules/pickups.test.ts` only.
    - **Validates: Requirements 7.6, 7.7, 8.10**
  - [ ]* 4.8 Write property test for core conservation in `match-cores.test.ts`
    - **Property 13: Cores are conserved**
    - **Not done.**
    - **Validates: Requirements 7.9**
  - [ ]* 4.9 Write property test for the drop allowance in `match-rams.test.ts`
    - **Property 15: At most one drop per Boost activation**
    - **Partial:** example test in `rules/match.test.ts` only.
    - **Validates: Requirements 8.2, 8.6, 8.11**
  - [ ]* 4.10 Write property test for drop placement in `match-rams.test.ts`
    - **Property 16: Dropped cores land on the course at the impact**
    - **Partial:** example assertion (`isDrivable` on dropped cores) in `rules/match.test.ts` only.
    - **Validates: Requirements 8.7**
  - [ ]* 4.11 Write unit tests for step order and boundaries in `match.test.ts`
    - `createMatch` state and `comet-lower` swap; dropped core at exactly 6000 ms not collectible; course core at exactly 8000 ms collectible; owner at 999/1000 ms; Boost activated this step moves at 1.5×; a bump across the next gate scores; both boosting unshielded crews each drop one; repeated contacts in one Boost drop one; mirrored paths tie and leave a core; a full rocket leaves a core to the other; eight crossings give two laps and 200 points; step 2699 runs and 2700 completes with the right breakdown; equal scores give a draw
    - **Partial:** everything except the `createMatch` state test and the `comet-lower` swap is covered across `rules/match.test.ts`, `rules/pickups.test.ts`, and `course.test.ts`.
    - _Requirements: 4.1, 4.2, 4.3, 6.3, 6.5, 7.1, 7.4, 7.7, 8.5, 9.1, 10.2, 10.3, 13.3_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add Ready, start eligibility, and the public match view
  - [x] 6.1 Extend `src/shared/rules/seats.ts`
    - `SeatSlot.ready`; `setReady` (`not-seated`, `not-calibrated`), `clearReady`, `seatReadiness`, `startBlocker` over a readiness list in `SEAT_IDS` order; setup below calibrated, disconnect, release, watch, and removal clear Ready
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [ ]* 6.2 Write property test for the Ready invariant
    - **Property 21: Ready implies a live, calibrated seat**
    - **Not done.** `seats.test.ts` has no Ready tests.
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.6**
  - [ ]* 6.3 Write property test for the start blocker
    - **Property 22: The start blocker is the first missing step**
    - **Not done.**
    - **Validates: Requirements 11.4, 11.5, 24.3**
  - [x] 6.4 Extend `server/rooms.ts`
    - `setReady` and `clearReady` through the seat rules; accepted Ready changes refresh room activity
    - _Requirements: 11.1, 11.3, 12.5_
  - [ ]* 6.5 Write property test for validator totality with the new types
    - **Property 26: The validator stays total with the new types**
    - **Not done:** the M2 Property 9 test was not extended for the new types.
    - **Validates: Requirements 15.2**
  - [ ]* 6.6 Write unit tests for the new validator cases
    - `ready.set` with true, false, `"true"`, 1, missing field, extra field; `match.start` with an extra field; `match.rematch` and `match.swap` as `unknown-type`
    - **Partial:** `ready.set` value cases (`server/match.test.ts`) and rematch/swap `unknown-type` (`server/validate.test.ts`) are covered; the missing- and extra-field cases are not.
    - _Requirements: 15.1, 15.2, 15.3_
  - [x] 6.7 Extend `server/public-view.ts`
    - Replace the task 1.3 placeholders: `toRoomState` with phase, per-seat Ready, result, and return reason from runtime info; `toMatchSnapshot` (both rockets, both crews with crossings, next gate, carried, score, course core availability, dropped cores with remaining lockout and lifetime, remaining match time, countdown remaining time, frozen); `toMatchAck` for the sender's crew; `toPublicResult`; all field by field
    - _Requirements: 13.5, 16.1, 16.2, 16.3, 16.4_
  - [ ]* 6.8 Write property test for public view privacy
    - **Property 27: Public match state never leaks private data**
    - **Not done.**
    - **Validates: Requirements 16.4, 16.5**
  - [ ]* 6.9 Write unit tests for public message shapes
    - Exact key sets of `room.state`, the match snapshot, acks, and the result; remaining durations clamp at 0
    - **Not done** (only the M2 control-test key-set test exists).
    - _Requirements: 13.5, 16.1, 16.2, 16.3_

- [ ] 7. Run the match on the server
  - [ ] 7.1 Extend `server/simulation.ts` with the match runtime
    - Runtime union (control test or match); one match id counter; `startMatch` ends a control test and starts the 3000 ms countdown on the server clock; countdown snapshots; GO at the deadline; fixed steps with the M2 accumulator and catch-up cap; completion → results, final snapshot, `deps.roomChanged`
    - `sync`: countdown disconnect → cancel with `countdown-cancelled`; occupant change or reopened seat in countdown/running → discard with `abandoned`; running disconnect → freeze with neutral steering for the disconnected Pilot and queue rejected `not-running`; all connected → resume without countdown; results ignore seat changes
    - Control test only in the lobby phase with the flag on; `phase`, `current`, `returnReason` accessors; catch step exceptions and discard as `abandoned` without logging identifiers
    - **Partial:** everything except the last item is implemented. A thrown `stepMatch` is not caught, and `simulation.tick()` runs unguarded inside `setInterval` in `server/websocket.ts`, so it would crash the process. Also, a freeze sets both crews' steering to neutral, not only the disconnected Pilot's (steering refreshes at 20 Hz after resume).
    - _Requirements: 10.5, 12.1, 12.6, 12.8, 13.1, 13.2, 13.3, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 15.8, 26.1, 26.2, 26.4_
  - [ ]* 7.2 Write property test for frozen matches
    - **Property 29: Frozen matches do not advance**
    - **Partial:** example test in `server/match.test.ts` only.
    - **Validates: Requirements 14.2**
  - [ ]* 7.3 Write unit tests for the match lifecycle
    - Fake clock: countdown at 2999/3000 ms; countdown snapshot fields; freeze and resume keep the match id; countdown disconnect cancels; hold expiry abandons; results unchanged after a disconnect; a match ends a running control test; ids from one counter; broadcast cadence during a match
    - **Partial:** `server/match.test.ts` covers countdown cancel, freeze, hold-expiry abandon, resume, and results staying frozen. The 2999/3000 ms boundary, countdown snapshot fields, ending a running control test, the shared id counter, and match broadcast cadence are not covered.
    - _Requirements: 10.5, 12.6, 12.8, 13.1, 14.1, 14.3, 14.4, 14.5, 14.6, 15.8, 26.1, 26.4_
  - [x] 7.4 Extend `server/dispatch.ts` and wire the room-change callback
    - Replace the task 1.3 refusals: `ready.set` (lobby only, `setReady`), `match.start` (host → `not-host`, phase → `wrong-phase`, blocker → `start-blocked`, then `startMatch`, `clearReady`, room broadcast)
    - Phase checks before mutation: claim, ready, and setup only in the lobby; release and watch refused in countdown and running; leave always allowed
    - Match input authorization: role from the bound seat, team from the seat, `not-running` unless running and unfrozen, then match id and sequence; the M2 Comet-only map stays for the control test
    - `server/websocket.ts` and `server/main.ts`: implement `roomChanged(code)` as a `room.state` broadcast
    - Note: `setup.update` is also accepted while a running match is frozen, so a reconnecting player can recalibrate (design M3-19).
    - _Requirements: 11.2, 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 13.4, 15.4, 15.5, 15.6, 15.7, 15.9_
  - [ ]* 7.5 Write property test for host start in `dispatch-start.test.ts`
    - **Property 23: Only the host starts a ready lobby**
    - **Partial:** example test in `server/match.test.ts` only.
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4**
  - [ ]* 7.6 Write property test for crew input authorization in `dispatch-input.test.ts`
    - **Property 24: Crew inputs are authorized per seat, team, and phase**
    - **Partial:** example test in `server/match.test.ts` only.
    - **Validates: Requirements 12.7, 13.4, 15.4, 15.5, 15.6**
  - [ ]* 7.7 Extend the rejected-messages property in `dispatch.test.ts`
    - **Property 25: Rejected messages change nothing**
    - **Not done:** the M2 Property 11 test was not extended to match state or the new messages.
    - **Validates: Requirements 15.7, 15.9**
  - [x]* 7.8 Write integration tests for a four-client match
    - In-process server on port 0 with four `ws` clients: join, claim, calibrate, Ready; non-host start refused; host start → countdown → running snapshots with both rockets; each Pilot steers only its own rocket; each Engineer charges only its own crew; with an injected clock the match reaches results and all four clients receive the same `room.state.result`
    - Covered by "runs a complete four-client match and sends identical results to a watcher" in `server/websocket.test.ts`.
    - _Requirements: 10.5, 12.1, 12.2, 15.4, 15.5, 16.2_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Extend the client data layer
  - [x] 9.1 Update `src/client/net/interpolate.ts` and `src/client/room-context.ts`
    - Snapshots carry per-team poses; `sampleAt` interpolates each team; session time from `sessionMs` or `matchMs`; reset on match id, frozen, or phase change
    - Room context: `phase`, match snapshot union, crew view from the seat's own crew, `liveMatchId` only while running and unfrozen (or a live control test in the lobby)
    - Update the M2 interpolation and room-context callers and tests
    - _Requirements: 16.6, 20.10, 24.5_
  - [ ]* 9.2 Write property test for two-rocket interpolation
    - **Property 33: Both rockets interpolate between snapshots**
    - **Partial:** example test in `client/flow.test.ts` only.
    - **Validates: Requirements 20.10**
  - [x] 9.3 Implement `src/client/flow.ts`
    - `FlowScreen` type and `screenForPhase(phase, seated, current)` per the design, including setup → practice in the lobby and setup → match during countdown/running
    - _Requirements: 17.1, 23.1, 24.5, 24.7_
  - [ ]* 9.4 Write unit tests for the flow table
    - Exhaustive table over phase × seated × current screen
    - **Partial:** representative cases in `client/flow.test.ts`, not the exhaustive table.
    - _Requirements: 17.1, 23.1, 24.5, 24.7_
  - [x] 9.5 Implement `src/client/practice.ts` and the controller option
    - `stepPilotPractice` (ghost on the course with the shared movement rules, rings in order, first success at ring 1) and `reduceEngineerPractice` (charges up to the goal, then Shield, then a successful activation; first success at the first accepted charge)
    - `motion/controller.ts`: optional `initialCrew` in local authority mode for `PRACTICE_START_ENERGY`; no imports from `net/`
    - _Requirements: 17.2, 17.3, 17.5, 17.7, 17.8_
  - [ ]* 9.6 Write property test for pilot practice
    - **Property 30: Pilot practice rings complete in order**
    - **Partial:** example test in `client/flow.test.ts` only.
    - **Validates: Requirements 17.2, 17.5, 17.8**
  - [ ]* 9.7 Write property test for engineer practice
    - **Property 31: Engineer practice steps complete in order**
    - **Partial:** example test in `client/flow.test.ts` only.
    - **Validates: Requirements 17.3, 17.5**
  - [ ] 9.8 Add the M3 copy to `src/client/ui/copy.ts`
    - Copy from the design Error Handling list; real copy or developer-only markers for the new reasons; helpers for the countdown label (3/2/1/GO), results headline, paused line, return notices, Watch waiting text, and non-host text; tutorial and results text re-exported from `src/shared/copy.ts`
    - **Partial:** the new reject reasons are mapped. The other M3 strings live inline in the screens (`lobby-screen.ts`, `practice-screen.ts`, `control-screen.ts`, `results-screen.ts`, `hud.ts`, `arena-canvas.ts`) with no helpers, and several differ from the design's proposed list. PRD 7.9 records the strings the code shows.
    - _Requirements: 14.7, 22.1, 22.2, 22.3, 23.2, 24.4, 24.6, 25.4_
  - [ ]* 9.9 Write unit tests for the client copy
    - Every reason maps to copy or the developer-only marker; countdown labels at 3000, 2001, 2000, 1, 0; win and draw headlines; paused line per seat; return notices
    - **Partial:** only the reason-mapping test (`ui/copy.test.ts`) exists.
    - _Requirements: 14.7, 22.1, 22.2, 22.3, 23.2, 24.6_

- [ ] 10. Render the course, both rockets, and the HUD
  - [ ] 10.1 Extend `src/client/ui/arena-geometry.ts`
    - Nova `capsulePoints`, `finPoints`, `trailDots` (boost doubles the count), `roundRectPath`, `gateSegment`, and `edgeMarkers` per the design
    - **Partial:** `edgeMarkers` and the Nova, core, halo, and gate proportion constants exist. The Nova capsule, fins, dotted trail, course outline, and gate lines are drawn inline in `arena-canvas.ts` instead of as pure geometry functions.
    - _Requirements: 20.3, 21.1, 21.2, 21.4_
  - [ ]* 10.2 Write property test for edge markers
    - **Property 34: Edge markers appear exactly for off-screen objects**
    - **Partial:** example test in `client/flow.test.ts` only.
    - **Validates: Requirements 21.1, 21.2, 21.4, 21.5**
  - [ ]* 10.3 Write unit tests for the new geometry
    - Capsule and fins fit the rocket length; dot counts with and without Boost; round-rect path corners
    - **Not done** (blocked by 10.1).
    - _Requirements: 20.3_
  - [x] 10.4 Extend `src/client/ui/arena-canvas.ts`
    - Course layer (track surface and walls) rendered once per resize; per frame gates (idle dashed, viewer's next gate solid; on Watch both next gates with team glyphs), course and dropped cores at `max(26 × scale, MIN_CORE_CSS_PX)`, dropped-core draining ring and owner glyph while locked, Comet and Nova sprites and trails, Boost and Shield on both, own-rocket halo and YOU tag, edge markers in chase mode
    - `drawScene(scene)`; keep `draw`, `drawPose`, and `drawEmpty` for the sensor test and control test; reduced motion keeps the full fixed course; no per-frame `shadowBlur`
    - Note: the entry point is `drawMatch(snapshot, poses, ownTeam)` rather than `drawScene(scene)`; practice uses `drawPractice`.
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 21.1, 21.2, 21.3, 21.4, 25.1_
  - [x] 10.5 Implement `src/client/ui/hud.ts`
    - `formatTimer`, `isFinalWarning`, a pure HUD view model from a snapshot, and `createHud` (glyph + label scores, timer, five pips per team with accessible labels, own-team halo, final-warning color, once-per-second pulse except under reduced motion, tabular figures)
    - Note: the final-warning check is inline (`remainingMs <= FINAL_WARNING_MS`); there is no exported `isFinalWarning` or separate view model.
    - _Requirements: 16.6, 19.2, 19.3, 19.4, 19.5, 19.7, 25.2_
  - [ ]* 10.6 Write property test for the HUD model
    - **Property 28: The HUD shows the snapshot**
    - **Not done.**
    - **Validates: Requirements 16.6**
  - [ ]* 10.7 Write unit tests for the timer
    - `formatTimer` at 90000, 61000, 10000, 1, 0; `isFinalWarning` at 10000 and 10001
    - **Partial:** `formatTimer` cases are in `client/flow.test.ts`; no final-warning boundary test.
    - _Requirements: 19.2, 19.4_

- [x] 11. Build the screens and wire the phone flow
  - [x] 11.1 Keep crew input handling in `src/client/ui/control-screen.ts` (revised; design M3-15)
    - Engineer event handling, steering sends, selection sync, activation failure display, and `engineerView` stay in the control screen, which serves both the dev control test and the match. No `crew-controls.ts` extraction.
    - _Requirements: 19.6, 19.8, 26.5_
  - [x] 11.2 Implement `src/client/ui/practice-screen.ts`
    - Tutorial for the role, PRACTICE watermark, pilot ghost on the fixed full course or the engineer panel fed by a separate local-authority controller, step hints, Skip after the first success, done → lobby with `practiced` recorded in app memory; no net client is passed in
    - Note: "PRACTICE" is the screen title rather than a watermark over the arena.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 18.1_
  - [x] 11.3 Serve the match from `src/client/ui/control-screen.ts` (revised; design M3-15)
    - `app.ts` mounts the control screen for `match`. Match mode: HUD, chase arena on the own crew's rocket, role panel for both crews; countdown overlay with numerals from `countdownRemainingMs`, role reminder, GO for `COUNTDOWN_NUMERAL_MS`; frozen note "Paused · [Seat] reconnecting" in the assertive region with Recalibrate; Recalibrate hidden otherwise; wake lock; gesture lock classes from M2
    - _Requirements: 14.7, 19.1, 19.6, 19.7, 19.8, 19.9, 20.8, 20.9, 22.1, 22.2, 22.3, 22.4_
  - [ ]* 11.4 Write unit tests for match-screen helpers
    - Recalibrate visibility per phase and frozen state; the practice module and screen import nothing from `net/`; the crew view is unchanged by practice events
    - **Not done.**
    - _Requirements: 17.6, 17.7, 19.9_
  - [x] 11.5 Implement `src/client/ui/results-screen.ts`
    - Headline in team color with the silhouette, or DRAW in white; per-team gates line, cores line, total; results note; Leave room; polite announcement; reads `room.state.result` only
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5_
  - [x] 11.6 Update `src/client/ui/lobby-screen.ts`
    - Seat states with Ready (check icon); Ready toggle for a seated, calibrated, practiced player; Host Start disabled with `startBlockerText`; non-host waiting text; return notice in the polite region; claims disabled with "A match is running. Watch it?" outside the lobby phase; dev control-test button for Comet seats while a control test runs
    - Note: the Start label is "Start", and the countdown-cancelled notice reads "Countdown cancelled. Check motion and get ready again." (both recorded in PRD 7.9).
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.6, 24.8, 26.5_
  - [ ]* 11.7 Write unit tests for lobby helpers
    - Seat state label per seat state; Ready toggle visibility; Start enabled only without a blocker; client blocker equals the server blocker for the same seats
    - **Not done.** (The client and server share one `startBlocker`, so they cannot disagree by construction.)
    - _Requirements: 24.1, 24.2, 24.3, 24.4_
  - [x] 11.8 Update `src/client/ui/room-watch-screen.ts`
    - HUD, fixed full course with both rockets, cores, and both next gates via `drawScene`; waiting text from the start blocker; still no motion request and no gameplay input; control-test label only for control-test snapshots
    - Note: uses `drawMatch`. The Watch seat list does not show Ready, and the frozen line is the M2 "Paused · waiting for the crew".
    - _Requirements: 25.1, 25.2, 25.3, 25.4_
  - [x] 11.9 Wire the flow in `src/client/app.ts` and `src/client/ui/setup-screen.ts`
    - Add `practice`, `match`, and `results` screens; navigate on `room` events with `screenForPhase`; per-seat `practiced` memory cleared on seat change; setup → practice in the lobby or → match during countdown/running; reconnect mid-match runs setup then opens the match; locked-screen and motion-screen sets include `match` and `practice`
    - Note: `practice` is in the motion set but not the locked-screen set (it is a scrolling menu-style screen).
    - _Requirements: 17.1, 19.1, 23.1, 24.5, 24.7_

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Update the PRD and device log, then verify
  - [x] 13.1 Update `rival-rockets-prd.md`
    - Section 7.9: a "Game loop (Milestone 3, proposed until approved)" block with every new string from `ui/copy.ts` and `src/shared/copy.ts`
    - Sections 4 and 8: proposed clarifications for M3-9 (wall slow overrides Boost), M3-10 (bump segment can score a gate), M3-11 (ram definition and allowance), M3-12 (pickup sweep segment), and the M3 interim end paths (M3-2), each marked proposed
    - Done at the audit. The 7.9 block lists the strings the screens actually show, wherever they live in the code.
    - _Requirements: 27.1, 27.2_
  - [x] 13.2 Add the M3 section to `docs/device-test-log.md`
    - The design's manual verification checklist and an empty row template for a four-phone match (iPhone Safari, Android Chrome, optional fifth Watch device) with columns for result agreement, p95 send-to-ack, and render delay; state that agents did not run these checks
    - _Requirements: 27.4_
  - [x] 13.3 Run the full verification sequence
    - `npm ci`, `npm run lint`, `npm test`, `npm run build`; `npm start` in the background, check `/healthz` and a WebSocket connect to `/ws` with an allowed origin, then stop the process; confirm `render.yaml` is unchanged; delete temporary files
    - Report what passed and list every manual check left for the user
    - _Requirements: 27.3, 27.5_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - The M3 exit (a complete four-person match on four real phones) is not verified by agents. The user runs the checklist in `docs/device-test-log.md` and records the results.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Property tests use fast-check with at least 100 runs and a `// Feature: m3-game-loop, Property N: <title>` tag.
- Each task references requirements for traceability. Checkpoints keep the build green between layers.
- Task 1.3 adds temporary refusals and placeholders so exhaustive consumers compile; tasks 6.7, 7.4, and 9.8 replace them.
- Match property tests are split across `match-clock`, `match-step`, `match-invariants`, `match-cores`, and `match-rams` test files so they can run in parallel waves; tasks writing the same file are in separate waves.
- Manual user steps, not agent tasks: the four-phone match, grayscale and readability checks, approving proposed copy and rule clarifications, and latency measurement during a four-phone match.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "2.1", "6.1", "6.5", "9.1", "9.3", "10.1"] },
    { "id": 2, "tasks": ["2.2", "2.5", "3.1", "3.7", "6.2", "6.4", "6.6", "9.2", "9.4", "10.2", "10.4", "10.5", "11.1"] },
    { "id": 3, "tasks": ["2.3", "2.6", "3.2", "3.4", "3.8", "3.10", "9.5", "10.3", "10.6"] },
    { "id": 4, "tasks": ["2.4", "2.7", "3.3", "3.5", "3.9", "3.11", "4.1", "6.3", "9.6", "9.8", "10.7"] },
    { "id": 5, "tasks": ["2.8", "3.6", "4.2", "4.3", "4.5", "4.7", "4.9", "4.11", "6.7", "9.7", "9.9", "11.2", "11.3", "11.5", "11.6"] },
    { "id": 6, "tasks": ["4.4", "4.6", "4.8", "4.10", "6.8", "7.1", "11.4", "11.7", "11.8", "11.9"] },
    { "id": 7, "tasks": ["6.9", "7.2", "7.4"] },
    { "id": 8, "tasks": ["7.3", "7.5", "7.6", "7.7", "7.8", "13.1", "13.2"] },
    { "id": 9, "tasks": ["13.3"] }
  ]
}
```

# Requirements Document

## Introduction

Milestone 3 ("Complete the game loop") of Rival Rockets, based on PRD v1.2 Sections 3–8, 10, 11 (AC1–AC8 and the foundations of AC11–AC13) and 12, `AGENTS.md`, and `docs/implementation-plan.md` tasks 3.1–3.5 with Sections 2–3.

M3 builds on the M2 room flow, gateway, and server-authoritative rocket, which were verified on two real phones. It adds the Nova crew and rocket, the one PRD Section 4 rounded-ring course with walls and ordinary bumps, ordered checkpoint scoring, course and dropped cores with boosted rams and shields, Ready and a host Start, a 3-2-1-GO countdown, the 90-second authoritative match, and a results screen. On the phone it adds role practice, the tutorial copy, the match HUD, both rockets with full team identity, the chase camera with edge markers, and a full-course Watch view.

The exit condition is: a complete four-person match works on four real phones. Agents cannot verify that; it is a manual check in the Device_Test_Log.

Out of scope: the pause/resume countdown, the Interrupted phase and screen, rematch, role swaps, lane alternation, and the full abuse regression (M4); detailed visual polish, Section 7.8 event bursts, sound, haptics for game events, and the dedicated spectator layout (M5).

All numbers below are PRD playtest starting values unless marked as an M3 development value. Performance figures are targets to measure, not results.

## Glossary

- **Shared_Config**: The shared constants module `src/shared/config.ts`. Holds every tunable gameplay, course, match, practice, and network value.
- **Design_Tokens**: The shared UI token module `src/shared/tokens.ts`. Holds colors, team identity, UI sizes, and UI timings for DOM and canvas.
- **Protocol**: The shared message contract module `src/shared/protocol.ts`.
- **Course**: The one PRD Section 4 course: the drivable ring inside the Outer_Wall and outside the Inner_Wall of the 600 × 800 logical arena.
- **Outer_Wall**: The rounded rectangle from (24, 24) to (576, 776) with corner radius 120.
- **Inner_Wall**: The rounded rectangle from (180, 188) to (420, 612) with corner radius 80.
- **Drivable_Region**: The set of rocket center positions at least 18 units (the rocket radius) inside the Outer_Wall and at least 18 units outside the Inner_Wall.
- **Course_Rules**: The pure module `src/shared/course.ts` for course geometry, wall containment, the clockwise wall tangent, and gate crossing tests.
- **Movement_Rules**: The pure module `src/shared/rules/physics.ts` for rocket turning, speed, and movement.
- **Collision_Rules**: The pure functions that detect rocket contact and apply separation, bump displacement, and boosted-ram core drops.
- **Scoring_Rules**: The pure module `src/shared/rules/scoring.ts` for ordered checkpoint progress, team score, score breakdown, and match result.
- **Pickup_Rules**: The pure module `src/shared/rules/pickups.ts` for Course_Cores, Dropped_Cores, capacity, ownership lockout, expiry, respawn, and contested pickups.
- **Ability_Rules**: The existing pure module `src/shared/rules/abilities.ts` for crew energy, charges, selection, activation, effects, and the shared cooldown.
- **Match_Rules**: The pure module `src/shared/rules/match.ts` that creates a match and advances it one fixed step.
- **Seat_Rules**: The existing pure module `src/shared/rules/seats.ts`, extended with Ready and start eligibility.
- **Control_Test**: The M2 development-only session in which the Comet crew flies one rocket with no score, timer, or result.
- **Control_Test_Flag**: The M2 server setting that enables the Control_Test: on with `--dev` or `RR_CONTROL_TEST=1`, off otherwise.
- **Room_Store**: The server's in-memory owner of rooms, participants, seats, tokens, holds, and expiry.
- **Simulation**: The server loop that owns each room's Control_Test or Match runtime, its input queue, its fixed-step accumulator, its countdown, and its broadcasts.
- **Gateway**: The server message handling in `server/dispatch.ts` and `server/websocket.ts`: validation order, membership, role and phase checks, rate limits, and replies.
- **Message_Validator**: The pure server function `validateMessage` that turns one raw frame into a typed client message or a rejection reason.
- **Public_View**: The server functions that copy only allowlisted fields into `room.state`, `match.state`, and `input.ack`.
- **Client**: The browser app on a phone or other device.
- **Seat**: One of the four fixed slots: Comet Pilot, Comet Engineer, Nova Pilot, Nova Engineer.
- **Crew**: The Pilot and Engineer Seats of one team (Comet or Nova) and the rocket they control.
- **Host**: The play participant who holds the room's start control (PRD 8).
- **Ready**: A per-Seat flag set by the Seat occupant to say the player is prepared for the next match.
- **Room_Phase**: The room's state as seen by players: `lobby`, `countdown`, `running`, or `results`.
- **Match**: One timed four-player competition with a match identifier, two Crews, the Course, cores, and a Match_Result.
- **Countdown**: The 3000 ms period between an accepted start and GO, measured on the Server_Clock.
- **Server_Clock**: The server's monotonic real-time clock, used for heartbeats, seat holds, rate limits, room expiry, and the Countdown.
- **Match_Time**: The Match clock in integer milliseconds. Starts at 0 at GO and advances only while the Match runs unfrozen.
- **Step**: One fixed Simulation update of 1000/30 ms of simulated time.
- **Frozen**: The M3 Match state while any Seat is disconnected: no Steps run and Match_Time stops.
- **Gate**: One of the four ordered checkpoint segments with a forward direction, from PRD Section 4.
- **Next_Gate**: The Gate a Crew must cross next: index (valid crossings modulo 4).
- **Valid_Crossing**: A swept movement of a rocket center from the back side of its Crew's Next_Gate line to the front side, through the Gate segment.
- **Course_Core**: One of the four collectible cores at the fixed PRD spawn points.
- **Dropped_Core**: A core knocked out of a rocket by a Boosted_Ram, with an original owner, an owner lockout, and a lifetime.
- **Carried_Cores**: The number of cores a Crew's rocket holds, from 0 to 5.
- **Contact**: Two rocket collision circles overlapping in a Step.
- **Bump**: The displacement applied at the first Step of a Contact.
- **Boosted_Ram**: A Bump in which a Crew's Boost effect is active.
- **Drop_Allowance**: A Crew's permission to cause one core drop during the current Boost effect.
- **Team_Score**: 25 × Valid_Crossings + 10 × Carried_Cores.
- **Match_Result**: The frozen outcome of a completed Match: win with a winner team, or draw, plus a per-team score breakdown.
- **Practice_Screen**: The client-only role practice shown after calibration and before Ready.
- **Tutorial_Copy**: The PRD Section 4 Pilot and Engineer tutorial text.
- **Results_Explanation**: The PRD Section 4 results breakdown text.
- **Lobby_Screen**: The room lobby screen with seats, Ready, and Start.
- **Match_Screen**: The phone screen during the Countdown, the running Match, and a Frozen Match: HUD, arena, and role panel.
- **HUD**: The DOM bar at the top of the Match_Screen and Watch_View with both Team_Scores, the timer, and core pips.
- **Arena_Canvas**: The canvas renderer for the Course, Gates, cores, and rockets.
- **Chase_Camera**: The PRD 7.6 arena view that fits the course width and keeps the followed rocket at a fixed screen height.
- **Edge_Marker**: An indicator at the top or bottom edge of the Chase_Camera view for an off-screen object.
- **Results_Screen**: The screen that shows the Match_Result.
- **Watch_View**: The read-only room view for watchers.
- **Device_Test_Log**: The file `docs/device-test-log.md`.

## Requirements

### Requirement 1: Shared constants for the game loop

**User Story:** As a developer, I want every M3 gameplay and UI value defined once, so that tuning the course and rules cannot drift between server, client, tutorial, and results.

#### Acceptance Criteria

1. THE Shared_Config SHALL define as named constants the Outer_Wall and Inner_Wall rectangles and radii, the four Gates with their segments and forward directions in order, the four Course_Core spawn points, the Nova lower start lane (x 240, y 134, heading right), the core diameter (26), the pickup radius (31), the maximum Carried_Cores (5), the Course_Core respawn time (8000 ms), the Dropped_Core lifetime (6000 ms), the owner reclaim delay (1000 ms), the wall speed multiplier (0.6), the wall slow time (400 ms), the bump displacement (12), the Shield bump multiplier (0.25), the maximum drops per Boost (1), the checkpoint points (25), the core points (10), the checkpoint count (4), the match duration (90000 ms), and the start countdown (3000 ms).
2. THE Shared_Config SHALL define the practice ring positions, practice ring radius, practice starting energy, and practice charge goal as named M3 development values.
3. THE Design_Tokens SHALL define the minimum core size on a phone (14 CSS px), the final-warning time (10000 ms), the own-rocket tag time (5000 ms), the countdown numeral time (1000 ms), and the Edge_Marker sizes as named constants.
4. THE Course_Rules, Scoring_Rules, Pickup_Rules, Collision_Rules, and Match_Rules SHALL read every course coordinate, duration, point value, and limit from the Shared_Config.

### Requirement 2: Course geometry and wall containment

**User Story:** As a pilot, I want the walls to keep my rocket on the ring without trapping it, so that hitting a wall costs a little speed and nothing more.

#### Acceptance Criteria

1. THE Course_Rules SHALL treat a rocket center as inside the Course when the center lies in the Drivable_Region.
2. WHEN a rocket center ends a movement outside the Drivable_Region, THE Course_Rules SHALL move the center to the nearest point of the Drivable_Region boundary and report a wall contact with the wall's outward normal.
3. WHEN a wall contact occurs while the rocket heading points into the wall, THE Course_Rules SHALL set the heading to the clockwise wall tangent at the contact point.
4. WHEN a wall contact occurs while the rocket heading points along or away from the wall, THE Course_Rules SHALL keep the heading unchanged.
5. WHEN a wall contact occurs, THE Movement_Rules SHALL move the rocket at 0.6 × 120 units/s for the next 400 ms of Match_Time.
6. IF a rocket pose has a non-finite coordinate, THEN THE Course_Rules SHALL replace the pose with that Crew's start lane pose.
7. FOR ALL rocket poses, THE Course_Rules SHALL return a finite center inside the Drivable_Region and a finite heading (invariant).
8. FOR ALL rocket poses already inside the Drivable_Region, THE Course_Rules SHALL return the same pose and report no wall contact (idempotence).

### Requirement 3: Movement on the course

**User Story:** As a pilot, I want the same movement rules as in M2 on the real course, so that my practice on two phones carries over to the match.

#### Acceptance Criteria

1. WHILE no wall slow and no Boost effect is active, THE Movement_Rules SHALL move the rocket forward at 120 units/s.
2. WHILE a Crew's Boost effect is active and no wall slow is active, THE Movement_Rules SHALL move that Crew's rocket forward at 1.5 × 120 units/s.
3. WHILE a wall slow is active, THE Movement_Rules SHALL move the rocket forward at 0.6 × 120 units/s, whether or not a Boost effect is active.
4. THE Movement_Rules SHALL turn the rocket at the normalized steering value times 120°/s, with positive steering turning clockwise on screen.
5. WHILE steering is 0 and no wall contact occurs, THE Movement_Rules SHALL keep the rocket heading unchanged.
6. THE Movement_Rules SHALL use the Course walls in place of the M2 inset-arena clamp for both the Match and the Control_Test.

### Requirement 4: Second crew and start lanes

**User Story:** As a player on Team Nova, I want my own rocket in the race, so that two crews can compete.

#### Acceptance Criteria

1. WHEN a Match is created, THE Match_Rules SHALL create one rocket per Crew, with the Comet rocket at the upper start lane (x 240, y 78) and the Nova rocket at the lower start lane (x 240, y 134), both heading right.
2. THE Match_Rules SHALL store the lane assignment in the Match, so that M4 can alternate lanes without changing the Match shape.
3. WHEN a Match is created, THE Ability_Rules SHALL give each Crew 50 energy, Boost selected, no active effect, and no cooldown.
4. THE Match_Rules SHALL keep each Crew's steering, energy, selected ability, effects, cooldown, Valid_Crossings, and Carried_Cores separate from the other Crew's.

### Requirement 5: Ordinary bumps

**User Story:** As a pilot, I want rockets to bump without losing points, so that overtaking is physical but fair.

#### Acceptance Criteria

1. WHEN the two rocket collision circles of radius 18 overlap after movement in a Step, THE Collision_Rules SHALL move both rockets apart along the line between their centers until the overlap is removed.
2. WHEN a Contact begins in a Step after a Step without Contact, THE Collision_Rules SHALL displace each rocket up to 12 additional units away from the other.
3. WHILE a Contact continues from the previous Step, THE Collision_Rules SHALL apply overlap separation only and no additional displacement.
4. WHILE a Crew's Shield effect is active, THE Collision_Rules SHALL reduce that Crew's additional incoming bump displacement to 25% of the unshielded amount.
5. WHEN a bump moves a rocket center outside the Drivable_Region, THE Course_Rules SHALL contain the rocket with the Requirement 2 wall rules.
6. THE Collision_Rules SHALL leave every Crew's Valid_Crossings unchanged and SHALL change Carried_Cores only through a Boosted_Ram drop (Requirement 8).
7. FOR ALL pairs of rocket states, THE Collision_Rules SHALL displace each rocket by at most the overlap separation plus 12 units in one Step (invariant).

### Requirement 6: Ordered checkpoint scoring

**User Story:** As a crew, I want gates to count only in order and forward, so that driving backward or circling one gate earns nothing.

#### Acceptance Criteria

1. THE Scoring_Rules SHALL define the four Gates in order: top at x 300, y 24..188, forward right; right at y 400, x 420..576, forward down; bottom at x 300, y 612..776, forward left; left at y 400, x 24..180, forward up.
2. WHEN a rocket center's swept movement in a Step goes from on or behind its Crew's Next_Gate line to strictly in front of the line and passes through the Gate segment, THE Scoring_Rules SHALL count one Valid_Crossing for that Crew.
3. WHEN a Crew completes a Valid_Crossing, THE Scoring_Rules SHALL make the following Gate in order that Crew's Next_Gate, wrapping from the left Gate to the top Gate.
4. IF a rocket crosses any Gate backward, crosses a Gate other than its Crew's Next_Gate, or ends a movement exactly on a Gate line, THEN THE Scoring_Rules SHALL leave that Crew's Valid_Crossings unchanged.
5. THE Scoring_Rules SHALL test both the movement segment and the bump displacement segment of each Step for Valid_Crossings, so that a bump across the Next_Gate counts and cannot leave the Crew stuck behind a passed gate.
6. THE Scoring_Rules SHALL award no lap bonus.
7. FOR ALL rocket paths, THE Scoring_Rules SHALL count exactly the crossings that a reference ordered-forward-crossing model counts for the same path (model-based).
8. FOR ALL Match Steps, THE Match_Rules SHALL keep each Crew's Valid_Crossings equal to or greater than the value before the Step (invariant).

### Requirement 7: Course cores and pickups

**User Story:** As a pilot, I want to grab cores and see them respawn, so that cores are worth chasing.

#### Acceptance Criteria

1. WHEN a Match is created, THE Pickup_Rules SHALL make the four Course_Cores available at (420, 106), (498, 300), (300, 694), and (102, 500).
2. WHEN a rocket center's swept path in a Step comes within 31 units of an available Course_Core or a collectible Dropped_Core and the rocket carries fewer than 5 cores, THE Pickup_Rules SHALL treat the rocket as an eligible contact for that core.
3. WHEN a core has eligible contacts in a Step, THE Pickup_Rules SHALL give the core to the eligible rocket with the earliest swept contact time in that Step and add 1 to that Crew's Carried_Cores.
4. IF two eligible rockets reach the same core at exactly the same contact time, THEN THE Pickup_Rules SHALL leave the core uncollected in that Step.
5. IF a rocket carrying 5 cores reaches a core, THEN THE Pickup_Rules SHALL leave the core in place for other rockets.
6. WHEN a Course_Core is collected, THE Pickup_Rules SHALL make that Course_Core unavailable and available again at the first Step whose Match_Time is at least 8000 ms after collection.
7. WHEN a Course_Core's respawn time is reached, THE Pickup_Rules SHALL make the Course_Core available before pickups in that Step.
8. FOR ALL Match Steps, THE Pickup_Rules SHALL keep each Crew's Carried_Cores between 0 and 5 inclusive and give each core to at most one rocket (invariant).
9. FOR ALL Match Steps, THE Pickup_Rules SHALL change the total of both Crews' Carried_Cores plus the number of Dropped_Cores by exactly the number of Course_Cores collected minus the number of Dropped_Cores expired (model-based).

### Requirement 8: Boosted rams, shields, and dropped cores

**User Story:** As an engineer, I want a boosted hit to knock out a rival's core and my Shield to block it, so that Boost and Shield timing decide fights.

#### Acceptance Criteria

1. WHEN a Bump occurs while one Crew's Boost effect is active, that Crew's Drop_Allowance is unused, the other Crew has no active Shield, and the other Crew carries at least one core, THE Collision_Rules SHALL remove one core from the other Crew's Carried_Cores and create one Dropped_Core owned by the other Crew.
2. WHEN a Boosted_Ram causes a core drop, THE Collision_Rules SHALL mark the attacking Crew's Drop_Allowance as used until the Crew's next Boost activation.
3. IF the rammed Crew's Shield effect is active, THEN THE Collision_Rules SHALL drop no core and leave the attacking Crew's Drop_Allowance unused.
4. IF the rammed Crew carries no cores, THEN THE Collision_Rules SHALL drop no core and leave the attacking Crew's Drop_Allowance unused.
5. WHEN both Crews' Boost effects are active, neither Crew's Shield is active, and a Bump occurs, THE Collision_Rules SHALL evaluate each Crew as attacker independently, so that each Crew can lose one core.
6. WHEN a Crew activates Boost, THE Match_Rules SHALL reset that Crew's Drop_Allowance to unused.
7. WHEN a Dropped_Core is created, THE Collision_Rules SHALL place the Dropped_Core at the midpoint of the two rocket centers at Contact, projected onto the Drivable_Region.
8. THE Pickup_Rules SHALL make a Dropped_Core collectible from the Step after the Step that created it.
9. WHILE less than 1000 ms of Match_Time has passed since a Dropped_Core was created, THE Pickup_Rules SHALL treat the Dropped_Core's original owner Crew as ineligible to collect that Dropped_Core.
10. WHEN a Step's Match_Time is at least 6000 ms after a Dropped_Core was created, THE Pickup_Rules SHALL remove the Dropped_Core before pickups in that Step.
11. FOR ALL sequences of Contacts during one Boost effect, THE Collision_Rules SHALL cause at most one core drop from the opponent per Boost activation (invariant).

### Requirement 9: Match step order and determinism

**User Story:** As a developer, I want one pure, ordered match step, so that the server and tests run identical rules and coincident events resolve the PRD way.

#### Acceptance Criteria

1. WHEN the Match_Rules run a Step, THE Match_Rules SHALL process, in order: due effect expirations, Dropped_Core expiry, and Course_Core respawns; validated crew inputs in arrival order; movement, wall containment, and gate crossings; Contacts, bumps, and core drops; and then eligible pickups.
2. THE Match_Rules SHALL compute Match_Time for Step n as the integer floor of n × 1000 / 30 milliseconds, so that every PRD duration boundary lands on an exact Step.
3. THE Match_Rules SHALL receive the Match state and the queued inputs as arguments and read no clock, socket, or random source.
4. FOR ALL Match states and input batches, THE Match_Rules SHALL return the tick plus one and exactly one result per input in arrival order, each applied or rejected with a reason (invariant).
5. FOR ALL Match states and input batches, THE Match_Rules SHALL return deep-equal output when called twice with the same arguments (determinism).

### Requirement 10: Score, victory, and result

**User Story:** As a player, I want the score explained and the winner decided by the server, so that every phone shows the same result.

#### Acceptance Criteria

1. THE Scoring_Rules SHALL compute each Team_Score as 25 × Valid_Crossings + 10 × Carried_Cores.
2. WHEN a Match completes, THE Scoring_Rules SHALL produce a Match_Result with outcome win and the higher-scoring team as winner when the Team_Scores differ.
3. WHEN a Match completes with equal Team_Scores, THE Scoring_Rules SHALL produce a Match_Result with outcome draw and no winner.
4. THE Match_Result SHALL include, per team, the Valid_Crossings, checkpoint points, Carried_Cores at the finish, core points, and total.
5. WHILE the room is in the `results` Room_Phase, THE Simulation SHALL keep the Match_Result unchanged, including after participants leave or disconnect.
6. FOR ALL Valid_Crossings and Carried_Cores values, THE Scoring_Rules SHALL return a breakdown whose checkpoint points plus core points equals the total (invariant).

### Requirement 11: Ready and start eligibility

**User Story:** As a host, I want the game to start only when all four players are connected, calibrated, and ready, so that nobody starts unprepared.

#### Acceptance Criteria

1. WHEN the occupant of a Seat sends a valid `ready.set` while the Room_Phase is `lobby` and the Seat is connected and calibrated, THE Seat_Rules SHALL set that Seat's Ready flag to the requested value.
2. IF a `ready.set` with value true comes from a Seat whose setup status is not calibrated, THEN THE Gateway SHALL reject the request with the reason `not-calibrated` and leave all state unchanged.
3. WHEN a Seat's setup status drops below calibrated, the Seat is released, or the Seat's occupant disconnects, THE Seat_Rules SHALL clear that Seat's Ready flag.
4. THE Seat_Rules SHALL report the first start blocker in Seat order (Comet Pilot, Comet Engineer, Nova Pilot, Nova Engineer) as the Seat and the missing step: join, reconnect, calibrate, or get ready.
5. WHEN all four Seats are occupied, connected, calibrated, and Ready, THE Seat_Rules SHALL report no start blocker.
6. FOR ALL sequences of seat, setup, connection, and Ready operations, THE Seat_Rules SHALL keep every Ready Seat occupied, connected, and calibrated (invariant).

### Requirement 12: Host start and countdown

**User Story:** As a host, I want one Start button that explains what is missing and then counts down, so that everyone begins together.

#### Acceptance Criteria

1. WHEN the Host sends a valid `match.start` while the Room_Phase is `lobby` and the Seat_Rules report no start blocker, THE Simulation SHALL end any running Control_Test, create a Match with a new match identifier, and enter the `countdown` Room_Phase.
2. IF a `match.start` comes from a participant who is not the Host, THEN THE Gateway SHALL reject the request with the reason `not-host` and leave all state unchanged.
3. IF a `match.start` arrives while the Seat_Rules report a start blocker, THEN THE Gateway SHALL reject the request with the reason `start-blocked` and leave all state unchanged.
4. IF a `match.start` arrives while the Room_Phase is not `lobby`, THEN THE Gateway SHALL reject the request with the reason `wrong-phase` and leave all state unchanged.
5. WHEN a Match enters the `countdown` Room_Phase, THE Seat_Rules SHALL clear all four Ready flags, so that Ready applies to one match only.
6. WHEN 3000 ms of Server_Clock time have passed since the Countdown began, THE Simulation SHALL enter the `running` Room_Phase with Match_Time 0.
7. WHILE the Room_Phase is `countdown`, THE Gateway SHALL reject gameplay inputs with the reason `not-running`.
8. WHILE the Room_Phase is `countdown`, THE Simulation SHALL broadcast `match.state` snapshots with the start poses and the countdown remaining time.

### Requirement 13: Ninety-second match clock

**User Story:** As a player, I want the server to stop the match at exactly 90 seconds, so that late inputs cannot change the result.

#### Acceptance Criteria

1. WHILE the Room_Phase is `running` and the Match is not Frozen, THE Simulation SHALL advance the Match one Step per 1000/30 ms of accumulated Server_Clock time, capped by the M2 catch-up limit.
2. THE Simulation SHALL run only Steps whose start Match_Time is strictly below 90000 ms, so that no event at 90000 ms or later can change a score.
3. WHEN Match_Time reaches 90000 ms, THE Simulation SHALL compute the Match_Result, broadcast a final `match.state`, and enter the `results` Room_Phase.
4. IF a gameplay input arrives while the Room_Phase is `results`, THEN THE Gateway SHALL reject the input with the reason `not-running` and leave all state unchanged.
5. THE `match.state` snapshot SHALL carry the remaining Match_Time as a duration, so that device clocks need not agree.

### Requirement 14: Disconnects during an M3 match

**User Story:** As a crew, I want a dropped phone to freeze the match instead of letting the rocket fly blind, so that nobody loses because of Wi-Fi.

#### Acceptance Criteria

1. WHEN any Seat's occupant disconnects or times out while the Room_Phase is `running`, THE Simulation SHALL freeze the Match, set the disconnected Pilot's steering to 0, and reject that room's queued inputs with the reason `not-running`.
2. WHILE a Match is Frozen, THE Simulation SHALL run no Steps, so that Match_Time, physics, effects, cooldowns, wall slows, and core timers stay unchanged.
3. WHEN all four Seats are connected again before any Seat hold expires, THE Simulation SHALL resume the same Match without a resume countdown.
4. IF any Seat's occupant disconnects while the Room_Phase is `countdown`, THEN THE Simulation SHALL cancel the Countdown, discard the Match, and return the room to the `lobby` Room_Phase with the return reason `countdown-cancelled`.
5. IF a Seat reopens or changes occupant while the Room_Phase is `countdown` or `running`, THEN THE Simulation SHALL discard the Match without a Match_Result and return the room to the `lobby` Room_Phase with the return reason `abandoned`.
6. WHILE the Room_Phase is `results`, THE Simulation SHALL keep the Match_Result unchanged when a participant disconnects, reconnects, or leaves.
7. WHILE a Match is Frozen, THE Client SHALL show "Paused · [Seat name] reconnecting" for the first disconnected Seat, with a Recalibrate control.

### Requirement 15: Protocol, validation, and crew authorization

**User Story:** As a player, I want only the right person to control each part of each rocket, so that nobody can steer or charge for the other crew.

#### Acceptance Criteria

1. THE Protocol SHALL add `ready.set` with a request identifier and a boolean `ready`, and `match.start` with a request identifier, and SHALL keep `match.rematch` and `match.swap` absent.
2. WHEN a `ready.set` or `match.start` arrives, THE Message_Validator SHALL apply the M2 checks in order and reject a `ready` value that is not a boolean with the reason `invalid-value`.
3. IF a client sends `match.rematch` or `match.swap`, THEN THE Message_Validator SHALL reject the message with the reason `unknown-type`.
4. WHILE a Match is in the `running` Room_Phase and not Frozen, THE Gateway SHALL accept `input.steer` only from the Pilot Seat of a Crew and apply the steering to that Crew's rocket.
5. WHILE a Match is in the `running` Room_Phase and not Frozen, THE Gateway SHALL accept `input.charge` and `ability.request` only from the Engineer Seat of a Crew and apply them to that Crew.
6. IF a gameplay input comes from a watcher, an unseated participant, or a Seat whose role does not match the input type, THEN THE Gateway SHALL reject the input with the reason `not-authorized` and leave all state unchanged.
7. IF a `seat.claim`, `ready.set`, or `setup.update` arrives while the Room_Phase is not `lobby`, or a `seat.release` or `room.watch` arrives while the Room_Phase is `countdown` or `running`, THEN THE Gateway SHALL reject the request with the reason `wrong-phase` and leave all state unchanged.
8. THE Gateway SHALL draw Match and Control_Test identifiers from one counter, so that an input for one cannot be applied to the other.
9. FOR ALL invalid, unauthorized, wrong-phase, stale, or rate-limited messages, THE Gateway SHALL leave the serialized room, Match, and queue state identical to the state before the message (invariant).

### Requirement 16: Public match state and results

**User Story:** As a player, I want every phone to receive the same state and result, so that all four devices agree on ownership and score.

#### Acceptance Criteria

1. THE `room.state` message SHALL include the Room_Phase, each Seat's Ready flag, the Match_Result while the Room_Phase is `results`, and the return reason after a Countdown cancel or abandoned Match.
2. THE Match `match.state` snapshot SHALL include the match identifier, mode `match`, phase, tick, Match_Time, remaining Match_Time, countdown remaining time, Frozen flag, both rocket poses, and per Crew the energy, selected ability, active effect and remaining time, cooldown remaining time, Valid_Crossings, Next_Gate, Carried_Cores, and Team_Score.
3. THE Match `match.state` snapshot SHALL include each Course_Core's availability and each Dropped_Core's identifier, position, original owner, remaining lockout, and remaining lifetime.
4. THE Public_View SHALL build every Match message field by field from an allowlist, so that tokens, connection identifiers, addresses, limiter state, and hold deadlines stay out of public messages.
5. FOR ALL reachable room and Match states, THE serialized output of the Public_View SHALL contain only allowlisted keys and no private value (invariant).
6. WHEN a Client applies a `match.state` snapshot, THE Client SHALL display scores, Carried_Cores, Next_Gate, and core ownership from the snapshot and SHALL compute none of them locally.

### Requirement 17: Isolated role practice

**User Story:** As a new player, I want a short practice for my role that cannot affect the match, so that I learn the controls before Ready.

#### Acceptance Criteria

1. WHEN a seated player completes calibration while the Room_Phase is `lobby`, THE Client SHALL open the Practice_Screen for that Seat's role.
2. WHILE the Practice_Screen shows the Pilot practice, THE Client SHALL let the Pilot steer a ghost rocket on the Course through three rings in order, using the shared Movement_Rules and Course_Rules on the phone.
3. WHILE the Practice_Screen shows the Engineer practice, THE Client SHALL run practice-only energy that starts at the practice starting energy and SHALL ask the Engineer to fill two energy segments by shaking, select Shield, and activate.
4. THE Practice_Screen SHALL show a "PRACTICE" watermark while practice runs.
5. WHEN the player achieves the first practice success (the first ring for a Pilot, the first registered shake for an Engineer), THE Practice_Screen SHALL show a Skip control and enable the lobby Ready control for that Seat.
6. THE Practice_Screen SHALL send no gameplay input and no practice result to the server.
7. THE Practice_Screen SHALL keep practice energy, abilities, and ring progress separate from the Client's match crew view.
8. FOR ALL ghost rocket paths, THE Client practice rules SHALL complete rings only in order and report the first success at the first completed ring (invariant).

### Requirement 18: Tutorial and results copy from shared values

**User Story:** As a player, I want the tutorial and results to state the real rules, so that what I read is what the server enforces.

#### Acceptance Criteria

1. THE Practice_Screen SHALL show the Tutorial_Copy for the Seat's role before the player can set Ready.
2. THE Client SHALL build the Tutorial_Copy and the Results_Explanation from the Shared_Config point values, energy amounts, ability cost, durations, and cooldown.
3. WHERE the Shared_Config holds the PRD starting values, THE Client SHALL produce Tutorial_Copy and Results_Explanation text identical to PRD Section 4.
4. FOR ALL score breakdowns, THE Client SHALL render the Results_Explanation lines "Gates: [count] × 25 = [points]" and "Cores held: [count] × 10 = [points]" with points equal to the breakdown values (invariant).

### Requirement 19: Match screen, HUD, and role panels

**User Story:** As a player, I want scores, time, cores, and my controls readable at a glance, so that I can play while moving my phone.

#### Acceptance Criteria

1. THE Match_Screen SHALL render, top to bottom, the HUD, the Arena_Canvas, and the role panel in the PRD 7.6 portrait proportions.
2. THE HUD SHALL show the Comet Team_Score with ▲ COMET, the remaining Match_Time as minutes and seconds, and the Nova Team_Score with NOVA ●, with five core pips under each score filled to that Crew's Carried_Cores.
3. THE HUD SHALL mark the player's own team side with its glyph and a halo in its team color.
4. WHILE the remaining Match_Time is 10000 ms or less, THE HUD SHALL show the timer in the warning color and pulse the timer once per second.
5. WHERE the player prefers reduced motion, THE HUD SHALL show the final-warning timer in the warning color without the pulse.
6. THE Match_Screen SHALL reuse the M2 Pilot panel with the crew status row and the M2 Engineer panel, fed by the server crew state for that Seat's Crew.
7. THE HUD, scores, timer, and role panels SHALL be DOM elements over the canvas, with tabular figures for scores, timer, energy, and cooldown.
8. WHILE the Match is running, THE Match_Screen SHALL keep the M2 same-frame local feedback, 20 Hz steering, rotate overlay behavior, and rejection reasons.
9. WHILE the Room_Phase is `countdown` or `running` and the Match is not Frozen, THE Match_Screen SHALL hide the Recalibrate control.

### Requirement 20: Arena rendering and team identity

**User Story:** As a player, I want to tell the two rockets, the next gate, and the cores apart at a glance, also in grayscale, so that I always know what to chase.

#### Acceptance Criteria

1. THE Arena_Canvas SHALL draw the Course track surface in `--bg-track` and the Outer_Wall and Inner_Wall in `--line-wall`.
2. THE Arena_Canvas SHALL draw Gates that are not the viewer's Next_Gate dashed in `--gate-idle`, and the viewer Crew's Next_Gate solid in `--gate-next`.
3. THE Arena_Canvas SHALL draw the Comet rocket as an orange arrowhead with a chevron trail and the Nova rocket as a cyan rounded capsule with two fins and a dotted trail, both the same size.
4. THE Arena_Canvas SHALL draw available Course_Cores and Dropped_Cores as magenta circles 26 world units across and at least 14 CSS px on a phone, without changing server pickup boundaries.
5. THE Arena_Canvas SHALL draw each Dropped_Core with a ring that drains over its remaining lifetime and, while its owner lockout runs, the original owner's team glyph.
6. THE Arena_Canvas SHALL draw a thin white halo around the player's own rocket and a "YOU" tag for the first 5000 ms of Match_Time.
7. THE Arena_Canvas SHALL draw Boost and Shield effects on both rockets as in M2.
8. WHILE a seated player's Match_Screen is open, THE Arena_Canvas SHALL use the Chase_Camera following that Seat's own Crew rocket.
9. WHERE the player prefers reduced motion, THE Arena_Canvas SHALL show the full Course letterboxed and unscrolled in place of the Chase_Camera.
10. THE Arena_Canvas SHALL interpolate both rocket poses from the snapshot buffer with the M2 Interpolator.

### Requirement 21: Edge markers

**User Story:** As a pilot, I want markers for things above or below my view, so that the chase camera never hides the opponent, my next gate, or a core.

#### Acceptance Criteria

1. WHILE the Chase_Camera is active, THE Arena_Canvas SHALL show an Edge_Marker for the opponent rocket, the viewer Crew's Next_Gate, each available Course_Core, and each Dropped_Core whenever that object lies entirely outside the visible part of the arena.
2. THE Arena_Canvas SHALL place each Edge_Marker on the top edge for objects above the view and on the bottom edge for objects below the view, at the object's horizontal position clamped to the arena box.
3. THE Arena_Canvas SHALL distinguish Edge_Markers by shape and glyph: the opponent's team glyph, a gate bar for the Next_Gate, and a core circle for cores, in addition to color.
4. WHILE an object is at least partly visible, THE Arena_Canvas SHALL show no Edge_Marker for that object.
5. FOR ALL camera positions and object positions, THE Edge_Marker function SHALL return a marker exactly for the objects outside the visible range, on the correct edge, with an x inside the arena box (invariant).

### Requirement 22: Countdown screen

**User Story:** As a player, I want a clear 3-2-1-GO with a reminder of my job, so that I am ready at the start.

#### Acceptance Criteria

1. WHILE the Room_Phase is `countdown`, THE Match_Screen SHALL show full-screen numerals 3, 2, and 1, each for 1000 ms, from the server countdown remaining time.
2. WHEN the Room_Phase becomes `running`, THE Match_Screen SHALL show "GO" for 1000 ms without blocking input.
3. WHILE the countdown numerals are shown, THE Match_Screen SHALL show the role reminder "Tilt to steer" for a Pilot and "Shake to charge" for an Engineer.
4. WHERE the player prefers reduced motion, THE Match_Screen SHALL change the numerals without scale or motion animation.

### Requirement 23: Results screen

**User Story:** As a player, I want the winner and the math behind each score, so that the result feels fair.

#### Acceptance Criteria

1. WHEN the Room_Phase becomes `results`, THE Client SHALL open the Results_Screen for seated players and watchers.
2. THE Results_Screen SHALL show "COMET WINS" in Comet orange with the arrowhead silhouette, "NOVA WINS" in Nova cyan with the capsule silhouette, or "DRAW" in neutral white, from the Match_Result.
3. THE Results_Screen SHALL show, per team, the Results_Explanation lines and the total, followed by "Gate points stay. Core points reflect what you hold at the finish."
4. THE Results_Screen SHALL announce the headline in an `aria-live="polite"` region.
5. THE Results_Screen SHALL offer Leave room, and SHALL omit Rematch and Swap roles until M4 adds them.

### Requirement 24: Lobby, Ready, Start, and phone flow

**User Story:** As a group, I want one flow from joining to the match, so that four people reach the countdown without coaching.

#### Acceptance Criteria

1. THE Lobby_Screen SHALL show each Seat card as Open, Taken, Calibrated, Ready, or Disconnected, using a text label and an icon in addition to color.
2. WHILE a seated player has completed the first practice success and the Seat is calibrated, THE Lobby_Screen SHALL show a Ready toggle that sends `ready.set`.
3. WHILE the viewer is the Host, THE Lobby_Screen SHALL show a Start button that is disabled with the specific start blocker text while a blocker exists, using the PRD pattern "Waiting for [Seat name] to [step]".
4. WHILE the viewer is not the Host, THE Lobby_Screen SHALL show the start blocker text or "Waiting for the host to start".
5. WHEN the Room_Phase changes, THE Client SHALL navigate seated players to the Match_Screen for `countdown` and `running`, to the Results_Screen for `results`, and to the Lobby_Screen for `lobby`.
6. WHEN the room returns to the `lobby` Room_Phase with a return reason, THE Lobby_Screen SHALL show the matching notice in an `aria-live="polite"` region.
7. WHEN a seated player reconnects while the Room_Phase is `countdown` or `running`, THE Client SHALL run motion setup and then open the Match_Screen.
8. WHILE the Room_Phase is not `lobby`, THE Lobby_Screen SHALL disable seat claims and show that a match is running with a Watch option.

### Requirement 25: Watch view with the full match

**User Story:** As a spectator, I want to see the whole course with both rockets, so that I can follow the race from a fifth device.

#### Acceptance Criteria

1. THE Watch_View SHALL show the full Course with a fixed letterboxed camera, both rockets, all cores, and each Crew's Next_Gate marked with that team's glyph.
2. THE Watch_View SHALL show the HUD with both Team_Scores, the timer, and core pips.
3. THE Watch_View SHALL request no motion permission and send no gameplay input.
4. WHILE no Match or Control_Test runs, THE Watch_View SHALL show the Course with the start blocker text as a waiting message.

### Requirement 26: Development-only control test

**User Story:** As the team, I want the M2 two-phone control test kept for development, so that we can tune controls without four phones and without a public two-player mode.

#### Acceptance Criteria

1. WHERE the Control_Test_Flag is enabled, WHILE the Room_Phase is `lobby`, THE Simulation SHALL start the Control_Test under the M2 rules.
2. WHERE the Control_Test_Flag is disabled, THE Simulation SHALL start no Control_Test.
3. THE Control_Test SHALL fly the Comet rocket on the Course with wall containment and keep no score, timer, result, or winner.
4. WHEN a Match is created, THE Simulation SHALL end any running Control_Test in that room.
5. WHERE the Control_Test_Flag is enabled, THE Lobby_Screen SHALL offer the Comet Seats a control labeled "CONTROL TEST · not a match" that opens the Control_Test screen.

### Requirement 27: Copy, documentation, and verification

**User Story:** As a developer, I want new copy in the PRD and a clear manual check, so that the M3 exit is verified honestly.

#### Acceptance Criteria

1. WHEN M3 adds player-facing copy that the PRD lacks, THE PRD Section 7.9 copy table SHALL list that copy in a Milestone 3 block marked proposed until the user approves it.
2. WHEN M3 adopts a rule interpretation that PRD Section 4 or 8 leaves open, THE PRD SHALL record the interpretation in the same change, marked proposed until the user approves it.
3. THE `npm run lint`, `npm test`, and `npm run build` commands SHALL pass with the M3 changes.
4. THE Device_Test_Log SHALL include an M3 scenario checklist and a row template for a four-phone match on iPhone Safari and Android Chrome, stating that agents did not run these checks.
5. THE `render.yaml` file SHALL keep its current instance plan.

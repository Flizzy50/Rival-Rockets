# Requirements Document

## Introduction

Milestone 2 ("Prove shared control") of Rival Rockets, based on PRD v1.2 Sections 4, 5, 7.6, 8, 9, 10, 11 and 12, AGENTS.md, and `docs/implementation-plan.md` tasks 2.1–2.4 (decisions D1–D7).

M2 adds an in-memory room flow, a secure WebSocket transport on the existing Express server, and one server-authoritative rocket that a Comet Pilot and a Comet Engineer control from two phones. Crew energy, the selected ability, effects, and the shared cooldown move from the M1 phone-local simulation to the server. Phones keep processing raw motion locally and send only normalized steering, charge events, and ability requests.

The exit condition is: two phones reliably control the same rocket. This is an internal development proof. It does not enable a competitive match with fewer than four players and adds no public two-player mode. A second rocket, the course walls, checkpoints, cores, scoring, the match timer, results, the pause/resume flow, Ready, match start, rematch, and role swaps belong to M3 and M4.

All numbers below are PRD playtest starting values unless marked as an M2 development value. Performance and latency figures are targets to measure, not results.

## Glossary

- **Shared_Config**: The shared constants module `src/shared/config.ts`. Holds every tunable gameplay, motion, and network value.
- **Protocol**: The shared message contract module that defines client and server message types, field shapes, and public state shapes.
- **Message_Validator**: The pure server-side function that turns one raw WebSocket message into either a typed client message or a rejection reason.
- **Seat_Rules**: The pure module that decides seat claims, releases, host assignment, and room capacity.
- **Room_Store**: The server-side in-memory owner of rooms, participants, seats, Reconnect_Tokens, and room expiry.
- **Gateway**: The `ws` WebSocket server attached to the existing Express HTTP server. Owns origin checks, connection binding, rate limits, heartbeats, dispatch, and acknowledgements.
- **Rate_Limiter**: The pure token or window counter used by the Gateway for per-IP, per-connection, and per-seat limits.
- **Simulation**: The server loop that advances each running Control_Test at a fixed step and broadcasts public snapshots.
- **Movement_Rules**: The pure module that advances one rocket from its state, normalized steering, boost state, and a time step.
- **Ability_Rules**: The existing pure module `src/shared/rules/abilities.ts` for crew energy, charges, activation, effects, and the shared cooldown, extended with server-owned ability selection.
- **Public_View**: The server function that copies only allowlisted fields from server state into `room.state` and `match.state` messages.
- **Client**: The browser app on a phone or other device.
- **Control_Screen**: The M2 Pilot or Engineer screen that sends inputs over the Gateway and shows authoritative state.
- **Watch_View**: The read-only arena view for a participant who joined to watch.
- **Interpolator**: The pure client module that computes a rocket pose between two buffered snapshots.
- **Latency_Monitor**: The client module that records send-to-applied-ack and render delay timings in memory.
- **Control_Test**: The M2 development-only session in which one Comet rocket is flown by the Comet Pilot and Comet Engineer. Has no score, timer, results, or winner.
- **Control_Test_Flag**: The server setting that enables the Control_Test. Off unless development mode or an explicit environment variable enables it.
- **Room_Code**: Six uppercase characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. A public locator, never a credential.
- **Share_Link**: A URL on the game origin that carries the Room_Code and nothing else.
- **Seat**: One of the four fixed slots: Comet Pilot, Comet Engineer, Nova Pilot, Nova Engineer.
- **Participant**: A person in a room, joined with intent to play or to watch.
- **Host**: The Participant who holds the room's start and rematch controls (used from M3). In M2 the Host is identified only.
- **Reconnect_Token**: A private per-Seat credential of at least 128 bits of cryptographic randomness.
- **Applied_State_Ack**: An `input.ack` message that reports whether a gameplay input was applied and, when applied, the tick and resulting state.
- **Server_Clock**: The server's monotonic clock, used for heartbeats, seat holds, room expiry, and rate limits.
- **Session_Time**: The Control_Test clock. Advances only while the Control_Test is running. Used for charge spacing, effects, and cooldowns.
- **Device_Test_Log**: The file `docs/device-test-log.md`.

## Requirements

### Requirement 1: Shared constants and message contracts

**User Story:** As a developer, I want every M2 value and message shape defined once and shared by client and server, so that tuning and validation cannot drift.

#### Acceptance Criteria

1. THE Shared_Config SHALL define as named constants the room code alphabet and length (6), display name limit (16 graphemes), client message limit (1024 UTF-8 bytes), Reconnect_Token size (at least 128 bits), heartbeat interval (1000 ms), heartbeat timeout (3000 ms), seat hold (15000 ms), room inactivity limit (1800000 ms), simulation rate (30 Hz), broadcast rate (18 Hz), client steering rate (20 messages/s), server steering limit (30 messages/s per Pilot Seat), ability request limit (5 requests/s per Engineer Seat), socket message limit (40 messages/s per connection), room creation limit (5 per minute per source IP), room join limit (10 per minute per source IP), arena size (600 × 800), rocket radius (18), rocket length (48), base speed (120 units/s), maximum turn rate (120°/s), boost speed multiplier (1.5), and the Comet upper start lane (x 240, y 78, heading right).
2. THE Shared_Config SHALL define the M2 development values for client interpolation delay, latency sample window size, and the 150 ms p95 latency target as named constants.
3. THE Protocol SHALL define every client message type, server message type, field name, and public state shape used in M2 in one shared module imported by both the Client and the server.
4. WHERE an M1 constant duplicates a value now in Shared_Config, THE Shared_Config SHALL derive the M1 constant from the shared value.

### Requirement 2: Create and join a room

**User Story:** As a player, I want to create a room or join one by code, so that my friends and I end up in the same game.

#### Acceptance Criteria

1. WHEN a Client sends a valid `room.create` with a display name, THE Room_Store SHALL create a room with a new Room_Code, add the sender as a play Participant, and make the sender the Host.
2. WHEN the Room_Store generates a Room_Code, THE Room_Store SHALL draw each of the six characters from the Room_Code alphabet using cryptographic randomness and retry until the code differs from every live room's code.
3. WHEN a Client sends a valid `room.join` with an existing Room_Code, a display name, and an intent of play or watch, THE Room_Store SHALL add the sender to that room as a Participant with that intent.
4. IF a `room.join` names a Room_Code that matches no live room, THEN THE Gateway SHALL reject the request with the reason `room-not-found` and leave all room state unchanged.
5. IF a play `room.join` arrives while the room already has four play Participants, THEN THE Gateway SHALL reject the request with the reason `room-full` and an offer to join as a watcher, and leave every existing Participant and Seat unchanged.
6. WHEN the server receives a display name, THE Message_Validator SHALL trim the name, normalize the name to Unicode NFC, and count grapheme clusters with `Intl.Segmenter`.
7. IF a display name is empty after trimming, exceeds 16 grapheme clusters, or contains a control character or line break, THEN THE Gateway SHALL reject the request with the reason `invalid-name` and leave all room state unchanged.
8. THE Client SHALL render every display name as plain text.
9. IF a source IP exceeds 5 `room.create` attempts or 10 `room.join` attempts within one minute, counting failed attempts, THEN THE Gateway SHALL reject the excess attempt with the reason `rate-limited` and a retry instruction.

### Requirement 3: Share the room

**User Story:** As a host, I want a link and QR code for my room, so that friends can join without typing.

#### Acceptance Criteria

1. WHILE a Client is in a room lobby, THE Client SHALL show the Room_Code, a QR code that encodes the Share_Link, and a Share link control.
2. THE Client SHALL build the Share_Link from the game origin and the Room_Code only.
3. WHEN a Client opens a Share_Link, THE Client SHALL prefill the join form with the Room_Code from the link.
4. WHERE the Web Share API is available, THE Client SHALL offer the Share_Link through the Web Share API, and otherwise THE Client SHALL copy the Share_Link to the clipboard.
5. THE Client SHALL generate the QR code on the device without contacting any third-party service.

### Requirement 4: Four fixed seats and the host

**User Story:** As a player, I want to claim one open role that nobody else can take, so that each crew has exactly one Pilot and one Engineer.

#### Acceptance Criteria

1. THE Seat_Rules SHALL model exactly four Seats per room: Comet Pilot, Comet Engineer, Nova Pilot, and Nova Engineer.
2. WHEN a play Participant without a Seat sends `seat.claim` for an open Seat, THE Seat_Rules SHALL assign that Seat to that Participant.
3. IF a `seat.claim` names a Seat that is occupied or held for reconnection, THEN THE Seat_Rules SHALL reject the claim with the reason `seat-taken` and leave every Seat unchanged.
4. IF a Participant that already occupies a Seat sends `seat.claim`, THEN THE Seat_Rules SHALL reject the claim with the reason `already-seated` and leave every Seat unchanged.
5. IF a watch Participant sends `seat.claim`, THEN THE Seat_Rules SHALL reject the claim with the reason `watching` and leave every Seat unchanged.
6. WHEN a seated Participant sends `seat.release`, THE Seat_Rules SHALL reopen that Seat and clear its setup status.
7. WHEN a Participant sends `room.watch`, THE Seat_Rules SHALL release that Participant's Seat, if any, and change that Participant's intent to watch.
8. IF the Host leaves the room or the Host's Seat hold expires, THEN THE Seat_Rules SHALL transfer the Host role to the longest-connected seated Participant.
9. IF no seated Participant remains when the Host role must transfer, THEN THE Seat_Rules SHALL leave the room without a Host until the next Participant claims a Seat, and THE Seat_Rules SHALL make that Participant the Host.
10. THE Seat_Rules SHALL assign the Host role only to play Participants.
11. FOR ALL sequences of create, join, claim, release, watch, leave, and expiry operations, THE Seat_Rules SHALL keep at most one occupant per Seat, at most one Seat per Participant, and no Seat occupied by a watch Participant (invariant).

### Requirement 5: Private reconnect tokens

**User Story:** As a player, I want only my own browser to be able to take back my seat, so that someone with the room code cannot steal my role.

#### Acceptance Criteria

1. WHEN a Seat is assigned to a Participant, THE Room_Store SHALL generate a new Reconnect_Token for that Seat with at least 128 bits of cryptographic randomness.
2. WHEN a Seat is assigned, THE Gateway SHALL send the Reconnect_Token only to that Participant's connection, in a private `session.accepted` message.
3. THE Public_View SHALL exclude Reconnect_Tokens, connection identifiers, source IPs, and rate-limiter state from every `room.state` and `match.state` message.
4. FOR ALL reachable room states, THE serialized output of the Public_View SHALL contain no Reconnect_Token value (invariant).
5. THE Client SHALL store the Reconnect_Token in session storage for the current browser tab and exclude the token from URLs, QR codes, logs, and diagnostics.
6. WHILE a seated Participant's connection is closed and the Seat hold has not expired, THE Room_Store SHALL hold the Seat for 15000 ms of Server_Clock time.
7. WHEN a Client sends `seat.reconnect` with the matching Room_Code, Seat, and Reconnect_Token before the Seat hold expires, THE Room_Store SHALL bind the new connection to that Seat and close any older connection for that Seat.
8. IF a `seat.reconnect` carries a missing, wrong, or expired Reconnect_Token, THEN THE Gateway SHALL reject the request with the reason `reconnect-denied` and leave every Seat unchanged.
9. WHEN a Seat hold expires, THE Room_Store SHALL reopen the Seat and invalidate its Reconnect_Token.
10. THE Room_Store SHALL keep at most one active connection per Seat.

### Requirement 6: Room inactivity expiry

**User Story:** As an operator, I want idle rooms removed, so that server memory and room codes are released.

#### Acceptance Criteria

1. WHEN the Room_Store accepts a create, join, seat claim, seat release, watch, setup update, or gameplay input, THE Room_Store SHALL refresh that room's last-activity time.
2. THE Room_Store SHALL leave the last-activity time unchanged for heartbeats, rejected messages, and watch-only viewing.
3. WHEN a room's last activity is 1800000 ms or more in the past on the Server_Clock, THE Room_Store SHALL send `room.error` with the reason `room-expired` to every connection in the room, close those connections, and delete the room.
4. WHEN a room is deleted, THE Room_Store SHALL make its Room_Code available for reuse and discard its Participants, Seats, and Reconnect_Tokens.

### Requirement 7: Secure same-origin WebSocket transport

**User Story:** As a developer, I want WebSockets served by the existing server on the same origin, so that one process owns all rooms and the page's HTTPS covers the socket.

#### Acceptance Criteria

1. THE Gateway SHALL accept WebSocket upgrades on the path `/ws` of the existing Express HTTP server.
2. IF an upgrade request's `Origin` header is missing or absent from the allowed origin list, THEN THE Gateway SHALL refuse the upgrade with HTTP status 403 before creating a WebSocket.
3. THE Gateway SHALL build the allowed origin list from the `RENDER_EXTERNAL_URL` and `ALLOWED_ORIGINS` environment variables.
4. WHERE the server runs in development mode, THE Gateway SHALL also allow an origin whose host equals the upgrade request's `Host` header.
5. IF an upgrade request targets a path other than `/ws`, THEN THE Gateway SHALL refuse the upgrade.
6. THE server SHALL keep all rooms and Control_Tests in the memory of one Node process.

### Requirement 8: Message validation before mutation

**User Story:** As a player, I want malformed or hostile messages ignored, so that nobody can corrupt the room or the rocket.

#### Acceptance Criteria

1. WHEN a WebSocket message arrives, THE Message_Validator SHALL check, in order, that the message is text, at most 1024 UTF-8 bytes, valid JSON, an object with a known `type`, limited to the allowed fields for that type, and within the allowed value ranges for every field.
2. IF a message fails any validation check, THEN THE Gateway SHALL send a rejection with the matching reason and leave all room, Seat, and Control_Test state unchanged.
3. IF a numeric field is NaN, Infinity, or not a number, THEN THE Message_Validator SHALL reject the message with the reason `invalid-value`.
4. WHEN a valid `input.steer` carries a finite steering value outside `[-1, 1]`, THE Message_Validator SHALL clamp the value to `[-1, 1]`.
5. FOR ALL byte strings and JSON values, THE Message_Validator SHALL return either a typed client message or a rejection reason, without throwing (error condition).
6. FOR ALL invalid, oversized, binary, or non-finite messages, THE Gateway SHALL leave the serialized room and Control_Test state identical to the state before the message (invariant).
7. THE Protocol SHALL carry no raw sensor readings, positions, energy values, or scores in any client message.

### Requirement 9: Transport rate limits

**User Story:** As an operator, I want floods dropped, so that one client cannot swamp the room or the server.

#### Acceptance Criteria

1. IF a connection sends more than 40 messages in one second, THEN THE Gateway SHALL reject the excess messages with the reason `rate-limited` without applying them.
2. IF a Pilot Seat sends more than 30 `input.steer` messages in one second, THEN THE Gateway SHALL reject the excess messages with the reason `rate-limited` without applying them.
3. IF an Engineer Seat sends more than 5 `ability.request` messages in one second, THEN THE Gateway SHALL reject the excess messages with the reason `rate-limited` without applying them.
4. THE Rate_Limiter SHALL measure every limit with the Server_Clock.
5. THE Gateway SHALL apply transport rate limits separately from the one-charge-per-second gameplay rule in Requirement 14.
6. THE Client SHALL send `input.steer` at no more than 20 messages per second.

### Requirement 10: Membership and role authorization

**User Story:** As a player, I want only the person in a seat to control that seat, so that nobody can steer or charge for my crew.

#### Acceptance Criteria

1. THE Gateway SHALL derive a message sender's room, Participant, team, and role only from the Seat bound to that connection.
2. IF an `input.steer` comes from a connection not bound to the Pilot Seat of the crew in the running Control_Test, THEN THE Gateway SHALL reject the message with the reason `not-authorized` and leave all state unchanged.
3. IF an `input.charge` or `ability.request` comes from a connection not bound to the Engineer Seat of the crew in the running Control_Test, THEN THE Gateway SHALL reject the message with the reason `not-authorized` and leave all state unchanged.
4. IF a gameplay input names a match identifier other than the running Control_Test's identifier, THEN THE Gateway SHALL reject the input with the reason `stale-match` and leave all state unchanged.
5. IF a gameplay input carries a sequence number less than or equal to the last sequence number accepted on that connection, THEN THE Gateway SHALL reject the input with the reason `stale-sequence` and leave all state unchanged.
6. IF a watch Participant or an unseated Participant sends a gameplay input, THEN THE Gateway SHALL reject the input with the reason `not-authorized` and leave all state unchanged.
7. IF a connection that has not joined a room sends any message other than `room.create`, `room.join`, `seat.reconnect`, or `heartbeat`, THEN THE Gateway SHALL reject the message with the reason `not-in-room`.

### Requirement 11: Heartbeat

**User Story:** As a crew member, I want a silent phone detected quickly, so that the rocket never keeps flying on a stale tilt.

#### Acceptance Criteria

1. WHILE a Client is connected to the Gateway, THE Client SHALL send a `heartbeat` message every 1000 ms.
2. WHEN the Gateway receives a `heartbeat`, THE Gateway SHALL record the receipt time on the Server_Clock and reply with `heartbeat.ack`.
3. IF a connection sends no `heartbeat` for 3000 ms, THEN THE Gateway SHALL treat the connection as disconnected and close the connection.
4. WHEN a Pilot's connection closes or times out, THE Simulation SHALL set that crew's steering to 0 before the next step.
5. IF a Client receives no `heartbeat.ack` for 3000 ms, THEN THE Client SHALL show the connection-lost message and attempt to reconnect with its Reconnect_Token.

### Requirement 12: Applied-state acknowledgements

**User Story:** As a developer, I want each input acknowledged with the state it produced, so that I can measure real control latency.

#### Acceptance Criteria

1. THE Protocol SHALL require a match identifier and a sequence number on every `input.steer`, `input.charge`, and `ability.request`.
2. WHEN the Simulation applies an accepted gameplay input in a step, THE Gateway SHALL send that input's sender an Applied_State_Ack with the sequence number, status `applied`, the step tick, and the resulting state for that input type.
3. WHEN the Gateway or the Ability_Rules reject a gameplay input, THE Gateway SHALL send that input's sender an Applied_State_Ack with the sequence number, status `rejected`, and the rejection reason.
4. THE Applied_State_Ack for `input.steer` SHALL include the applied steering value and the rocket pose after the step.
5. THE Applied_State_Ack for `input.charge` and `ability.request` SHALL include the crew energy, selected ability, active effect remaining time, and shared cooldown remaining time after the step.

### Requirement 13: Clear room errors

**User Story:** As a player, I want every room problem explained with a next step, so that I am never stuck.

#### Acceptance Criteria

1. WHEN the Gateway rejects a room request, THE Gateway SHALL send a `request.rejected` message with the request identifier and a reason code from the Protocol.
2. WHEN the Client receives a rejection or `room.error`, THE Client SHALL show plain copy that states what happened and what to do next.
3. IF the Client's connection closes and reconnecting fails, THEN THE Client SHALL show an error card with Create room and Join room actions.
4. WHEN M2 adds player-facing copy that the PRD lacks, THE PRD Section 7.9 copy table SHALL list that copy.

### Requirement 14: Server-owned crew energy and abilities

**User Story:** As an engineer, I want the server to decide charges and activations, so that both crew phones show the same energy and a modified client cannot cheat.

#### Acceptance Criteria

1. WHEN a Control_Test starts, THE Ability_Rules SHALL give the crew 50 energy, Boost selected, no active effect, and no cooldown.
2. WHEN the server applies an accepted `input.charge` at least 1000 ms of Session_Time after the crew's last accepted charge and the crew has less than 100 energy, THE Ability_Rules SHALL add 25 energy, capped at 100.
3. IF an `input.charge` arrives less than 1000 ms of Session_Time after the crew's last accepted charge, THEN THE Ability_Rules SHALL reject the charge with the reason `rate-limited` and leave the crew state unchanged.
4. IF an `input.charge` arrives while the crew has 100 energy, THEN THE Ability_Rules SHALL reject the charge with the reason `full` and leave the crew state unchanged.
5. WHEN the server applies `ability.request` with intent `select` and an ability, THE Ability_Rules SHALL set the crew's selected ability to that ability at no energy cost.
6. WHEN the server applies `ability.request` with intent `activate` while the crew has at least 50 energy and no active effect or cooldown, THE Ability_Rules SHALL spend 50 energy, start the crew's selected ability for 2000 ms, and start the 3000 ms shared cooldown.
7. IF `ability.request` with intent `activate` arrives while an effect or cooldown is running, THEN THE Ability_Rules SHALL reject the request with the reason `cooldown` and leave the crew state unchanged.
8. IF `ability.request` with intent `activate` arrives while the crew has less than 50 energy, THEN THE Ability_Rules SHALL reject the request with the reason `not-enough-energy` and leave the crew state unchanged.
9. THE Ability_Rules SHALL activate the crew's server-owned selected ability, and THE Message_Validator SHALL reject an `activate` request that names an ability with the reason `invalid-field`.
10. FOR ALL sequences of charges, selections, and activations at any times, THE Ability_Rules SHALL keep crew energy within 0 to 100 inclusive (invariant).
11. FOR ALL sequences of charges at any times, THE Ability_Rules SHALL accept at most one charge in any 1000 ms window of Session_Time (invariant).
12. FOR ALL crew states and times, THE Ability_Rules SHALL return a crew state equal to the input crew state for every rejected charge or activation (error condition).

### Requirement 15: Server movement rules

**User Story:** As a pilot, I want the server to move the rocket from my tilt with the PRD movement values, so that both phones see the same flight.

#### Acceptance Criteria

1. THE Movement_Rules SHALL move the rocket forward at 120 units/s while no Boost is active.
2. WHILE the crew's Boost effect is active, THE Movement_Rules SHALL move the rocket forward at 1.5 times the base speed.
3. THE Movement_Rules SHALL turn the rocket at the normalized steering value times 120°/s, with positive steering turning clockwise on screen.
4. WHEN steering is 0, THE Movement_Rules SHALL keep the rocket heading unchanged.
5. WHEN a Control_Test starts, THE Movement_Rules SHALL place the rocket at the Comet upper start lane (x 240, y 78) heading right.
6. THE Movement_Rules SHALL keep the rocket center within the 600 × 800 arena, inset by the 18-unit rocket radius, as the M2 boundary until M3 adds the course walls.
7. FOR ALL rocket states, steering values, boost states, and time steps, THE Movement_Rules SHALL return a finite position inside the inset arena and a finite heading (invariant).
8. FOR ALL rocket states and time steps with steering 0, THE Movement_Rules SHALL return the same heading as the input state (invariant).

### Requirement 16: Fixed-step simulation and broadcasts

**User Story:** As a developer, I want a fixed server step and a steady broadcast rate, so that movement is deterministic and the network load is predictable.

#### Acceptance Criteria

1. WHILE a Control_Test is running, THE Simulation SHALL advance the Control_Test in fixed steps of 1000/30 ms of Session_Time.
2. WHILE a Control_Test is running, THE Simulation SHALL broadcast a `match.state` snapshot to every connection in the room at an average of 18 snapshots per second.
3. WHEN the Simulation runs a step, THE Simulation SHALL process, in order, due effect and cooldown expirations, accepted ability requests and charges, and then movement.
4. THE Movement_Rules and Ability_Rules SHALL receive Session_Time and inputs as arguments and read no clock, socket, or random source.
5. IF the server falls behind by more than the maximum catch-up step count, THEN THE Simulation SHALL drop the excess elapsed time instead of running extra steps.
6. THE `match.state` snapshot SHALL include the match identifier, mode `control-test`, tick, Session_Time, rocket pose, crew steering, crew energy, selected ability, active effect and remaining time, and cooldown remaining time.

### Requirement 17: Development-only control test

**User Story:** As the team, I want shared control proven without creating a two-player game, so that the four-player rule stays intact.

#### Acceptance Criteria

1. WHERE the Control_Test_Flag is enabled, WHEN both Comet Seats are occupied by connected Participants whose setup status is calibrated, THE Simulation SHALL start a Control_Test with a new match identifier.
2. WHERE the Control_Test_Flag is disabled, THE Simulation SHALL start no Control_Test.
3. THE server SHALL enable the Control_Test_Flag only in development mode or when the `RR_CONTROL_TEST` environment variable equals `1`.
4. THE Control_Test SHALL contain one Comet rocket and no score, checkpoint, core, match timer, result, winner, or second rocket.
5. WHILE either Comet Seat is disconnected during a Control_Test, THE Simulation SHALL freeze the Control_Test's Session_Time and rocket, with steering set to 0.
6. WHEN both Comet Seats are connected again before their holds expire, THE Simulation SHALL resume the same Control_Test.
7. WHEN a Comet Seat reopens or changes occupant, THE Simulation SHALL end the Control_Test, so that a later Control_Test starts with fresh crew and rocket state.
8. IF a Client sends `ready.set`, `match.start`, `match.rematch`, or `match.swap`, THEN THE Message_Validator SHALL reject the message with the reason `unknown-type`.
9. WHILE a Control_Test is running, THE Client SHALL label the Control_Screen and Watch_View "CONTROL TEST · not a match".

### Requirement 18: Motion setup in the room

**User Story:** As a seated player, I want to check motion and set neutral for my role before flying, so that the rocket responds to real tilt and shake.

#### Acceptance Criteria

1. WHEN a Participant claims a Seat, THE Client SHALL open the M1 motion setup for that Seat's role.
2. WHEN the M1 sensor check passes or calibration completes, THE Client SHALL send `setup.update` with only the status `readings` or `calibrated`.
3. WHEN the server applies a `setup.update` from a seated connection, THE Room_Store SHALL store the status on that connection's Seat.
4. IF motion permission is denied or no readings arrive within 3000 ms, THEN THE Client SHALL keep the Seat's setup status unverified and offer Try again and Watch instead.
5. WHEN a Participant chooses Watch instead, THE Client SHALL send `room.watch` and open the Watch_View.

### Requirement 19: Shared control screens with immediate local feedback

**User Story:** As a crew member, I want my phone to react the instant I move it and then show what the server decided, so that controls feel responsive and both phones agree.

#### Acceptance Criteria

1. WHEN a Pilot tilts the phone, THE Control_Screen SHALL update the tilt gauge on the same frame and send the normalized steering in `input.steer`.
2. WHEN the Engineer's shake detector registers a gesture, THE Control_Screen SHALL send `input.charge` and show the local charge pop on the same frame.
3. WHEN the Engineer's stable tilt changes the local selection, THE Control_Screen SHALL show the new selection on the same frame and send `ability.request` with intent `select`.
4. WHEN the Engineer taps Activate, THE Control_Screen SHALL show the pressed state on the same frame and send `ability.request` with intent `activate`.
5. WHEN the Control_Screen receives an Applied_State_Ack or a `match.state` snapshot, THE Control_Screen SHALL display the server's energy, selected ability, active effect, and cooldown in place of local predictions.
6. WHEN the Control_Screen receives a rejected Applied_State_Ack for an activation, THE Control_Screen SHALL show the rejection reason for 1500 ms using the M1 failure copy.
7. WHILE the rotate overlay is visible, THE Control_Screen SHALL send steering 0 and send no selection changes.
8. THE Pilot Control_Screen SHALL show a read-only crew status row with the server's selected ability, energy, cooldown, and active effect.
9. THE Control_Screen SHALL render crew status, energy, selection, and the Activate button as DOM elements over the canvas.
10. WHERE a seated Participant holds a Nova Seat, THE Client SHALL show the read-only arena with a note that the control test uses the Comet rocket only.

### Requirement 20: Client interpolation and arena

**User Story:** As a player, I want the rocket to move smoothly on every phone, so that the 18 Hz updates do not look jerky.

#### Acceptance Criteria

1. THE Client SHALL buffer recent `match.state` snapshots and render the rocket at the current estimated Session_Time minus the interpolation delay.
2. THE Interpolator SHALL interpolate position linearly and heading along the shorter angular direction between the two snapshots around the render time.
3. FOR ALL pairs of snapshots and interpolation fractions in `[0, 1]`, THE Interpolator SHALL return a position on the segment between the two positions and a heading within the shorter arc between the two headings (invariant).
4. IF the render time is later than the newest buffered snapshot, THEN THE Interpolator SHALL hold the newest snapshot's pose.
5. THE Client SHALL draw the arena with the M1 arena canvas, letterboxed and uncropped, with the Comet rocket and visible Boost and Shield states.

### Requirement 21: Read-only Watch view

**User Story:** As a spectator, I want to watch the rocket without a seat or motion setup, so that I can follow along or recover when my phone's motion fails.

#### Acceptance Criteria

1. WHEN a watch Participant joins a room, THE Client SHALL open the Watch_View without requesting motion permission.
2. THE Watch_View SHALL show the room code, the four Seats with names and connection state, and the interpolated arena.
3. THE Watch_View SHALL send no gameplay input.
4. WHILE a room has no running Control_Test, THE Watch_View SHALL show the arena with a waiting message.

### Requirement 22: Latency measurement and private diagnostics

**User Story:** As a developer, I want send-to-applied-ack latency and render delay measured separately, so that I can report control responsiveness against the 150 ms target.

#### Acceptance Criteria

1. WHEN the Client sends a gameplay input, THE Latency_Monitor SHALL record the local send time against the input's sequence number.
2. WHEN the Client receives the matching Applied_State_Ack with status `applied`, THE Latency_Monitor SHALL record the send-to-ack interval for that input type.
3. THE Latency_Monitor SHALL report the sample count, median, and p95 of send-to-ack intervals over the latest window of samples, separately for steering, charge, and ability inputs.
4. THE Latency_Monitor SHALL measure render delay, from snapshot receipt to the first frame that displays a Session_Time at or after that snapshot, and report render delay separately from send-to-ack latency.
5. THE Latency_Monitor SHALL keep measurements in memory only and discard them when the page closes.
6. THE Latency_Monitor and server logs SHALL exclude display names, Room_Codes, Reconnect_Tokens, connection identifiers, IP addresses, device identifiers, and raw sensor data.
7. FOR ALL sets of interval samples, THE Latency_Monitor SHALL return a p95 value that is at least the median and at most the maximum sample (invariant).

### Requirement 23: Build, deployment, and manual verification

**User Story:** As a developer, I want the server build to include the shared rules and a clear manual check on real phones, so that the M2 exit is verified honestly.

#### Acceptance Criteria

1. THE server build SHALL compile the server and the shared modules it imports, so that `npm start` runs the WebSocket server in production.
2. THE `npm run build`, `npm run lint`, and `npm test` commands SHALL pass with the M2 changes.
3. THE `render.yaml` file SHALL keep its current instance plan, and the README SHALL record moving to a paid Render instance as a manual user decision.
4. THE Device_Test_Log SHALL include an M2 scenario checklist and a row template for two-phone shared control on iPhone Safari and Android Chrome, including the p95 send-to-ack latency and render delay.
5. THE README SHALL document how to run the development server with WebSockets on the LAN and how to enable the Control_Test on a deployed instance.

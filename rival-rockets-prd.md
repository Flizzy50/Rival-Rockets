# Rival Rockets
## Product requirements document

**Version:** 1.0 · **Date:** October 24, 2026 · **Status:** Proposed specification for a hackathon MVP

**Product pitch:** Four friends turn their phones into the controls for two rival rockets. Pilots tilt to steer while engineers shake to generate power and choose when to boost or shield. The crew that coordinates best wins a 90-second space race.

This document defines the proposed product. Performance targets and gameplay values are requirements to validate, not results already achieved.

## 1. Purpose and challenge fit

Build a browser party game that produces an immediately understandable, entertaining competition for a group of friends. Players should be able to join from a link, learn their role in seconds, and experience a complete match without installing an app.

The game addresses the three Mystery Stack ingredients:

| Ingredient | Product response | Evidence in the demo |
| --- | --- | --- |
| Phone motion | Pilots steer by tilting. Engineers generate power by shaking and select an ability by tilting. | Show physical movements causing visible changes in the game. |
| Rivalry | Two crews compete for checkpoints and cores, with boosts, shields, and collisions creating direct interaction. | Both scores and the remaining time stay visible. |
| A group of at least four | Each rocket requires a pilot and an engineer; a competitive match requires two rockets. | A match cannot start until all four roles are occupied and ready. |

**Release boundary:** The MVP supports exactly four active players, plus optional spectators. It satisfies the four-person minimum. Flexible groups larger than four are a subsequent release, not an MVP acceptance criterion. Extra gunner roles discussed during ideation are deferred until their effect on team balance is designed and tested.

## 2. Audience and intended experience

The primary audience is a group of four friends playing in the same room, especially at a hackathon, student gathering, or party. Each player has a phone with motion sensors and an internet connection. An optional laptop or projector makes the race easier for an audience to follow, but is not required to play.

The emotional goal is cooperative chaos: “Boost on three,” “Shield now,” and a close finish that makes the losing team want a rematch. Every player should have a meaningful job throughout the round.

### Success targets

| Goal | MVP validation target |
| --- | --- |
| Fast entry | At least 4 of 5 observed groups reach the countdown within two minutes of opening the link, with working devices and normal permission prompts. |
| Understandable roles | At least 4 of 5 first-time players can explain their controls after the tutorial without additional coaching. |
| Reliable play | Complete three consecutive 90-second matches using four physical phones, including at least one iPhone and one Android phone. |
| Responsive control | Target a 95th-percentile interval of 150 ms or less between sending input and receiving a server acknowledgement containing its applied state on the demo network. Measure this separately from rendering delay. |
| Visible coordination | In observed matches, crews use both boost and shield and discuss when to activate them. If one role feels idle or purely repetitive, revise the mechanics. |

These are playtest targets. Small samples provide directional feedback, not evidence of broad product-market fit.

## 3. Player journey

1. A player opens the game and chooses **Create room**. The browser displays a room code and a shareable join link/QR code.
2. Three friends join, enter short display names, and choose an available team and role.
3. Each player taps **Enable motion**, completes a short sensor check, and calibrates a comfortable neutral phone position.
4. A brief role-specific practice screen confirms that the pilot can steer or the engineer can charge and activate an ability.
5. All four players mark themselves ready. The room creator starts a three-second countdown.
6. The teams compete for 90 seconds. The game shows the course, scores, timer, and each player's role information.
7. The results screen announces the winner or a draw, explains each score, and offers **Rematch** and **Swap roles**.

No account, email address, app installation, or payment is required.

## 4. Core game rules

### Course and movement

- One compact, top-down space course with a single clockwise route, four sequential checkpoint gates, and enough width to overtake.
- Both rockets begin side by side at the same progress position. Starting lanes alternate on rematches.
- Rockets move forward automatically. Pilots control turning through tilt; neutral tilt maintains the current heading.
- Touching a track wall slows the rocket and keeps it inside the playable course. Players cannot be permanently trapped or eliminated.
- Rockets can bump each other. Ordinary bumps displace them slightly but do not remove points or cores.
- The course remains visible on each phone. A spectator display may show a larger version of the same arena.

### Score and victory

**Team score = 25 × valid checkpoint crossings + 10 × cores currently carried.**

- Checkpoints count only in the required order and in the forward direction. Four valid crossings complete a lap; there is no additional lap bonus.
- Driving backward across a gate or repeatedly crossing the same gate cannot create points.
- Collectible cores appear at fixed, visible locations on the course. A rocket can carry up to five.
- A collected course core respawns after eight seconds. A rocket already carrying five leaves additional cores on the course.
- A successful boosted ram against an unshielded opponent knocks out one carried core. Each boost can cause at most one core drop.
- The dropped core can be collected by either crew; the original owner must wait one second before reclaiming it. It disappears after six seconds if uncollected.
- Dropping or collecting a core immediately changes the visible score. Checkpoint points cannot be lost.
- At 90 seconds, the server stops scoring and compares totals. The higher score wins; equal scores produce a draw.

All listed durations, point values, and limits are starting values for playtesting. Rule changes must update the tutorial and results explanation together.

## 5. Roles and phone controls

### Pilot

**Job:** Navigate the course, collect cores, and position the rocket for overtakes or rams.

| Input or display | Required behavior |
| --- | --- |
| Tilt left/right | Turn left/right relative to the calibrated neutral position. |
| Small movements near neutral | Use a dead zone and smoothing to prevent accidental wobble. |
| Larger tilt | Increase turning up to a safe maximum; extreme tilt provides no additional advantage. |
| Phone display | Show the arena, both scores, timer, own-team marker, and boost/shield state. |

Pilot controls must use relative tilt rather than compass heading. This avoids making play depend on which direction a player faces in the room.

### Engineer

**Job:** Generate energy and decide when the crew needs speed or protection.

| Input or display | Required behavior |
| --- | --- |
| A short shake | Add 25 energy, up to 100. Accept at most one charge event per second. |
| Tilt left and hold briefly | Select boost. |
| Tilt right and hold briefly | Select shield. |
| Return to neutral | Retain the selected ability. |
| Tap the large Activate button | Request the selected ability if the crew has enough energy and the shared cooldown has ended. |
| Phone display | Show the arena, energy, selected ability, cooldown, scores, and timer. |

Motion is central to the role; the activation button makes the final choice deliberate. Shaking must not accidentally switch the selected ability. Temporarily suspend selection changes during a detected shake, then require a stable tilt before changing selection again.

### Abilities

| Ability | Cost | Effect |
| --- | --- | --- |
| Boost | 50 energy | Increase forward speed for two seconds. A collision during the boost can cause the opponent to drop one core. |
| Shield | 50 energy | Prevent boosted core drops and reduce incoming bump displacement for two seconds. |

Both abilities use a shared three-second cooldown, starting on activation. Each crew begins with 50 energy. Energy can be generated during a cooldown. Failed activation attempts spend no energy and show the reason.

A shield protects from other rockets; it does not allow driving through walls. Ability effects have visible start and end states on every screen.

## 6. Required screens and behavior

| Screen | Required content and actions |
| --- | --- |
| Home | Product name, short explanation, Create room, Join room. |
| Lobby | Room code/link/QR, team names, four role slots, connection state, readiness, optional Watch link. Prevent duplicate role assignment. |
| Motion setup | Enable motion button, permission outcome, live input indicator, calibration, and a clear recovery path if no sensor readings arrive. |
| Practice | One short role-specific interaction. Practice inputs do not affect match energy or scores. |
| Match | Arena, scores, timer, role controls, clear teammate and opponent identities, pause/reconnection status. |
| Results | Winner/draw, checkpoints and held cores behind each score, rematch, and role swap. |

Use team labels and distinct rocket shapes in addition to color. Controls should have large touch targets, readable text, and sufficient contrast. Sound and haptic feedback are optional enhancements; all necessary information must also be visible.

Use a consistent phone orientation and prompt players to return to it if they rotate their devices. Do not depend on the browser enforcing an orientation lock. Allow recalibration before a match and during a connection pause.

If motion is denied or unavailable, explain how to retry and allow spectating. Touch/keyboard controls may exist for development and accessibility, but a touch-only demonstration does not validate the challenge's motion requirement.

## 7. Multiplayer and connection rules

- The server owns the match clock, physics, checkpoint order, pickups, ability state, and score. Phones send control inputs, not their own positions or scores.
- The server verifies team and role membership, clamps steering values, and enforces charge limits, energy costs, and cooldowns.
- A room cannot start with fewer than four connected, calibrated, ready players. Spectators cannot occupy roles or send gameplay inputs.
- Before a match, joining a full room should offer spectating rather than replacing another player.
- A visible disconnect or a three-second heartbeat timeout pauses the match and freezes the clock, physics, cooldowns, and pickup timers. Stop using stale steering inputs as soon as detected.
- Preserve the disconnected player's seat for 15 seconds. If the player returns, restore the role and resume after a three-second countdown once all four are connected.
- If the reconnection window expires, end the match as **Interrupted**, without declaring a winner. Return connected players to the lobby so the role can be filled again.
- Use a private reconnect token for a claimed seat. A room code alone must not permit taking over another person's role. Keep only one active connection per player seat.
- If the room creator leaves the lobby, another connected player receives the start/rematch controls.
- Rooms expire after 30 minutes of inactivity. A server restart may end active rooms in the MVP; affected clients must show a clear message and an option to create or join a new room.

## 8. Browser and technical requirements

Target **Safari on iPhone and Chrome on Android**, with exact device/browser versions recorded during testing. These are intended targets, not a claim that every device or browser configuration will work.

| Component | Requirement |
| --- | --- |
| Delivery | A responsive web application served over HTTPS. No native installation required. |
| Motion access | Use browser orientation and motion events. Feature-detect permission methods and request access directly from a user tap where required. Confirm actual usable readings before marking setup complete. |
| Calibration | Store a per-player neutral tilt, smooth noise, cap output, and verify axes for the chosen screen orientation on real devices. |
| Shake detection | Detect short bursts using filtered motion data and a cooldown. Do not reward increasingly violent or continuous movement. |
| Live transport | Use a secure WebSocket connection for rooms, inputs, acknowledgements, and game state. |
| Rendering | Render a lightweight 2D course locally on each client. Interpolate state updates for smooth movement. |
| Simulation | Start with a fixed server simulation rate around 30 updates per second and state broadcasts around 15–20 per second; tune from measured behavior. |
| Storage | Keep rooms and matches in server memory for the MVP. A database is unnecessary for the specified experience. |
| Deployment | Use hosting that supports persistent WebSocket connections. Deploy early enough to test real phones over HTTPS. |

Keep input messages small and rate-limited. The browser should process raw sensor readings locally and send only normalized steering, charge events, and ability requests.

## 9. Privacy, validation, and fairness

- Collect only a short display name and temporary session information. Do not request location, contacts, camera access, or financial information.
- Do not persist raw motion streams. Expire temporary room data with the room.
- Limit display-name length and render names as plain text. Validate message types, sizes, and values on the server.
- Check the WebSocket origin against the game deployment, enforce room/role access, and rate-limit room creation and input messages.
- Use server-controlled energy and cooldowns so a modified client cannot request unlimited actions.
- Browser-reported motion is not trustworthy proof of physical movement. Server limits reduce abuse but do not eliminate fabricated input; competitive anti-cheat is outside this casual MVP.
- Optional diagnostics should record timings and errors without collecting identifying information or raw sensor data.

## 10. Acceptance criteria

The MVP is complete when all of the following pass:

1. Four physical phones join through the deployed site, claim unique roles, calibrate, and complete a match. An optional fifth device can spectate.
2. Starting with three players, duplicate roles, a disconnected player, or an unready player is blocked with an understandable explanation.
3. Both pilots steer using real tilt, and both engineers generate energy using real motion. Permission denial and missing sensor data cannot falsely mark a player ready.
4. Shake events cannot accidentally change the chosen ability or exceed the server's charge limit.
5. Boost and shield consume the correct energy, respect the shared cooldown, and display consistently on all devices.
6. Backward gate crossings, repeated crossings of the current gate, and skipped gates do not create checkpoint points.
7. Boosted hits drop at most one core per boost, shields prevent the drop, and all clients agree on pickup ownership and score.
8. At the end of the match, every device shows the same result and score breakdown. A tie produces a draw.
9. A temporary disconnect pauses and resumes correctly; a longer disconnect produces an interrupted match without a winner.
10. Rematch resets scores, core locations, energy, timers, and ability state, alternates starting lanes, and respects any role swaps.
11. Invalid or unauthorized messages cannot modify another player's role or the authoritative match state.
12. The game remains readable and playable on the actual presentation phones, and observed responsiveness is recorded against the target.

Use small automated checks for scoring order, ability limits, pickups, timers, and role ownership. Use real-device tests for permissions, calibration, shaking, rotation, backgrounding, and connection recovery. Simulated sensor input cannot substitute for physical-device validation.

## 11. Build sequence

| Milestone | Deliverable | Exit condition |
| --- | --- | --- |
| 1. Prove the controls | Deployed sensor test with permission, calibration, tilt visualization, and shake detection. | Usable readings on the intended iPhone and Android devices. |
| 2. Prove shared control | A room with one rocket, a pilot, an engineer, and synchronized views. | Two phones reliably control the same rocket. |
| 3. Complete the game loop | Second rocket, course, checkpoints, cores, abilities, timer, and results. | A complete four-person match works. |
| 4. Handle interruptions | Readiness checks, reconnects, pause/resume, rematch, and input validation. | Failure paths behave according to the acceptance criteria. |
| 5. Prepare the presentation | Refined feedback, optional spectator view, concise tutorial, and repeated real-device playtests. | Three consecutive matches complete on the demonstration setup. |

The first milestone is the main feasibility gate. Resolve sensor access and control feel before investing in detailed art or additional mechanics.

## 12. Scope after the MVP

| Feature | Reason to defer / design question |
| --- | --- |
| Six or eight active players | A natural extension is three or four rockets with two-person crews. Odd-sized groups require a separate, meaningful participation model. |
| Gunner role and larger crews | Requires aiming, projectiles, and balance testing. A shared cooldown alone does not make unequal crew sizes fair. |
| Additional courses and hazards | Add after the first course produces satisfying overtakes and close finishes. |
| Accounts, progression, cosmetics, and leaderboards | Do not improve proof of the core four-player experience. |
| Public matchmaking, persistent rooms, and production scaling | Need a larger reliability, moderation, and infrastructure scope. |
| 3D graphics, native apps, and elaborate physics | Not needed to deliver the specified browser experience. |

## 13. Risks and decisions to validate

| Risk | Response |
| --- | --- |
| Different sensor behavior between devices | Test early, use relative calibration, tune thresholds, and show a live setup check. |
| Weak venue connectivity | Test the deployed endpoint from the venue network and prepare a separately tested network option. |
| Engineer role feels repetitive | Keep shake bursts brief and make boost-versus-shield timing matter. Validate with players before adding extra actions. |
| Shaking disrupts ability selection | Freeze selection while a shake is detected and require a stable tilt to switch. |
| Players struggle to watch a moving phone | Keep the whole course readable and support a shared spectator screen. |
| Cores dominate or barely affect outcomes | Adjust core values, pickup placement, and respawn times based on observed matches. |
| The judging rubric expects more than four active players | Confirm that expectation before finalizing submission scope; the proposed MVP explicitly supports four. |

## 14. Demo story

Open with: **“Two rockets. Four phones. Your teammate controls the one thing you need to win.”**

Have four participants join through the QR code and briefly demonstrate each role. Show a short live match with both ships visible on the spectator screen. Call attention to the physical controls, a coordinated boost, and the final score. End on the rematch screen so the complete experience is visible.

## 15. Technical references

Browser documentation reviewed for this specification:

- [MDN: Detecting device orientation](https://developer.mozilla.org/en-US/docs/Web/API/Device_orientation_events/Detecting_device_orientation) — motion/orientation events, HTTPS, permission gestures, and feature detection.
- [MDN: DeviceMotionEvent](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent) — available sensor values and coordinate differences across browsers.
- [MDN: WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) — persistent browser/server communication.

These references support the implementation approach. They do not establish that the game has been built or tested on the target phones.
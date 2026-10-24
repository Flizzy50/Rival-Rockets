# Rival Rockets
## Product requirements document

**Version:** 1.1 (adds UI/UX design specification) · **Date:** October 24, 2026 · **Status:** Proposed specification for a hackathon MVP

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

Section 7 defines the visual style, layouts, and feedback for these screens.

## 7. UI/UX design specification

This section defines how the game looks, reads, and responds. Sizes, colors, and timings are starting values to tune on the actual presentation phones, in line with the playtest approach in Section 4.

### 7.1 Design principles

| Principle | What it means in practice |
| --- | --- |
| Glanceable | A player focused on moving their phone must read critical state (score, timer, energy, selected ability) in about a second. Each screen region has one primary number or action. |
| Motion first | Every tilt and shake gets a visible local response on the same frame, before server confirmation. Authoritative results (energy, score) then update from server state. |
| Redundant team identity | Team is shown by color, rocket silhouette, name label, and trail pattern. No information depends on color alone. |
| Loud events, quiet chrome | Menus and HUD stay flat and calm. Animation budget goes to scoring, boosts, shields, and core drops. |
| Readable in a room | Phones are readable at arm's length while moving; the spectator screen is readable from about 4 m. |

### 7.2 Art direction: neon vector arcade

Flat 2D vector shapes on a deep-space background, with thin glowing outlines and minimal gradients. The style recalls classic vector arcade games with a modern flat UI. It is cheap to render on a canvas, high in contrast, resolution independent, and achievable without dedicated illustrators.

- **Background:** Near-black navy with a sparse, static star field. Parallax is allowed only on the spectator display. No busy artwork behind the track.
- **Track:** A drivable surface slightly lighter than space, bounded by bright wall lines, so the playable area is obvious at a glance.
- **Glow:** Reserved for rockets, cores, the next checkpoint, and ability effects. Use pre-rendered glow sprites or a single blurred duplicate stroke; avoid per-object canvas `shadowBlur` every frame, which is expensive on mid-range phones.
- **Avoid:** Photographic textures, 3D, and text baked into images.

### 7.3 Color system

Define colors once as design tokens (CSS custom properties) and share the same values with the canvas renderer.

| Token | Hex | Use |
| --- | --- | --- |
| `--bg-space` | `#0B0E1A` | App and arena background; text on team-colored buttons |
| `--bg-surface` | `#161B2E` | Panels, cards, HUD bars |
| `--bg-track` | `#141A30` | Drivable track surface |
| `--line-wall` | `#6B76C2` | Track walls |
| `--gate-idle` | `#5A64A0` | Inactive checkpoint gates (dashed) |
| `--gate-next` | `#FFFFFF` | Own crew's next checkpoint (solid, pulsing) |
| `--text-primary` | `#F2F4FF` | Main text |
| `--text-secondary` | `#A9B1D6` | Labels and hints |
| `--team-comet` | `#FF9F1C` | Team Comet (orange) |
| `--team-nova` | `#2EC4F1` | Team Nova (cyan) |
| `--core` | `#E86BFF` | Collectible cores (magenta, distinct from both teams) |
| `--shield` | `#E6F7FF` | Shield bubble outline |
| `--success` | `#5BE38F` | Ready, connected, calibrated |
| `--warning` | `#FFC857` | Paused, reconnecting, final 10 seconds |
| `--danger` | `#FF5C6C` | Errors, denied permission, failed activation, lost core |

Approximate contrast ratios calculated from these values against `--bg-space`: primary text about 17:1, secondary text about 9:1, both team colors about 9:1, core about 7:1, danger about 6:1, and idle gates about 3.4:1. Walls are about 4:1 against the track surface. Re-check with a contrast tool after any palette change.

- Team-colored buttons use dark `--bg-space` text. White text on orange or cyan fails contrast.
- Energy meters fill with the crew's team color, reinforcing identity instead of adding another color.
- Orange and cyan differ along the blue–yellow axis, which remains distinguishable for the most common red–green color vision deficiencies. Verify with a color-vision simulator (for example, Chrome DevTools vision-deficiency emulation) and a grayscale check; shapes and labels cover remaining cases.

### 7.4 Team identity

| Attribute | Team Comet | Team Nova |
| --- | --- | --- |
| Color | Orange `#FF9F1C` | Cyan `#2EC4F1` |
| Rocket silhouette | Sharp arrowhead (delta wing) | Rounded capsule with two fins |
| Trail pattern | Chevron segments | Dotted line |
| Glyph | ▲ | ● |
| Label | COMET | NOVA |

- Team names are placeholders and may change, but the two silhouettes and trail patterns must stay distinct.
- On phones, the player's own rocket has a thin white halo and a small "YOU" tag for the first five seconds of the match; afterward only the halo remains. Both rockets are the same size.
- Rockets render at least 28 CSS px long on a phone arena. Cores render at least 14 CSS px in diameter, plus glow.
- Role icons: a steering arrow for Pilot and a lightning bolt for Engineer, always paired with the text label.

### 7.5 Typography

- **Display:** Space Grotesk (SIL Open Font License), weights 500 and 700, for titles, scores, timer, room code, and banners.
- **Body and UI:** Inter (SIL Open Font License), weights 400 and 600.
- **Fallback:** The `system-ui` font stack. Self-host fonts with `font-display: swap`, keeping total font weight around 100 KB or less.
- Scores, timer, energy, and cooldown values use tabular figures (`font-variant-numeric: tabular-nums`) so numbers do not jitter as they change.
- Generated room codes avoid ambiguous characters (0/O, 1/I/L).

| Element (phone) | Size / weight (CSS px) |
| --- | --- |
| Room code | 48 / 700, letter-spacing 0.1em |
| Timer | 40 / 700 |
| Score | 32 / 700 |
| Screen title | 28 / 700 |
| Button label | 20 / 600 |
| Body | 17 / 400 |
| Caption (minimum) | 14 / 400; nothing smaller during a match |

The spectator display scales these by about 2.5×, with the timer at least 96 px tall on a 1080p screen. Use `rem` units so menu screens respect browser text-size settings.

### 7.6 Layout and orientation

**Orientation: portrait on all phone screens.** Portrait supports a one-handed grip with the engineer's thumb on Activate, a natural left/right lean for steering, and no rotation between lobby and match. Validate pilot comfort during Milestone 1. If a landscape steering-wheel grip tests clearly better, switch both roles to landscape together; the game keeps one orientation throughout, as required in Section 6.

If a phone is rotated, show a full-screen "Turn your phone upright" overlay. While it is visible, that client sends neutral steering and blocks engineer selection changes.

**Phone match layout (top to bottom):**

1. **HUD bar (~12% of height):** Comet score, timer, Nova score, with carried-core pips (five slots) under each score. The player's own team side is marked with its glyph and halo color.
2. **Arena (~58%):** The full course scaled to fit, never cropped or scrolled. The course shape is designed for a portrait aspect ratio of about 3:4.
3. **Role panel (~30%):** Role-specific controls described below.

```text
Pilot                                  Engineer
+--------------------------------+     +--------------------------------+
| ▲ COMET 75    01:12   NOVA 60 ●|     | ▲ COMET 75    01:12   NOVA 60 ●|
|   ooo..                 oo...  |     |   ooo..                 oo...  |
+--------------------------------+     +--------------------------------+
|                                |     |                                |
|          ARENA (canvas)        |     |          ARENA (canvas)        |
|     full course, never cropped |     |     full course, never cropped |
|                                |     |                                |
+--------------------------------+     +--------------------------------+
|  L [-----|##|-----] R          |     |  ENERGY [##][##][  ][  ]  50   |
|      tilt gauge + dead zone    |     |  [ BOOST ]   (hold)  [ SHIELD ]|
|  BOOST READY     ENERGY ##--   |     |  +--------------------------+  |
|                                |     |  |     ACTIVATE BOOST · 50  |  |
+--------------------------------+     +--------------------------------+
```

**Pilot panel**

- A horizontal tilt gauge with a needle showing the current normalized steering value. The dead zone is a shaded center band, and the ends mark maximum turn.
- A read-only crew status row showing the selected ability, energy, cooldown, and active effect, so the pilot can coordinate without looking at the engineer's phone.
- A "Tilt to steer" hint for the first five seconds only.

**Engineer panel**

- An energy meter with four segments of 25, filled in team color. A registered shake pops one segment and shows "+25".
- An ability selector with Boost on the left and Shield on the right, matching the tilt direction. The selected tile is filled; the other is outlined. A small progress ring fills during the "tilt and hold" period so the player sees a pending selection.
- While a shake is detected, the selector shows a lock icon and "Locked while charging", making the Section 5 selection freeze visible.
- An Activate button spanning the panel width and at least 96 CSS px tall. Its label names the selected ability and its cost. States:

| State | Appearance |
| --- | --- |
| Ready | Solid team color, dark text, e.g. "ACTIVATE BOOST · 50" |
| Not enough energy | Outlined, label "Need 25 more" |
| Cooldown | Outlined with a left-to-right fill sweep and seconds remaining, e.g. "1.4s" |
| Effect active | Pulsing team color with remaining effect time |

**General layout rules**

- Respect device safe areas with `env(safe-area-inset-*)`.
- No scrolling during a match. Disable text selection and long-press callouts on match controls.
- Do not disable pinch-zoom on menu screens; restrict gestures only on the match arena and controls (Section 7.11).
- Minimum touch target 48 × 48 CSS px with at least 8 px between targets.

### 7.7 Screen specifications

| Screen | Layout and behavior |
| --- | --- |
| Home | Wordmark, one-line pitch, primary **Create room** and secondary **Join room** stacked full width. Small note: "Needs 4 phones with motion sensors." |
| Join | Large auto-uppercase room code field and a display-name field limited to the Section 10 length. Inline validation with a specific message, e.g. "No room with that code." |
| Lobby | Room code at the top with QR code and **Share link** (Web Share API where available, copy-to-clipboard otherwise). Two team columns, each with Pilot and Engineer slot cards. Slot states: Open (dashed outline, "Tap to join"), Taken, Calibrated, Ready (success check), Disconnected (warning). A Ready toggle at the bottom. The creator's Start button stays disabled with a specific reason, e.g. "Waiting for Nova Engineer to calibrate." A Watch link opens the spectator view. |
| Motion setup | Three-step indicator: Enable → Check → Calibrate. **Enable motion** is a direct user tap. Check shows a dot that moves with tilt; engineers also see "Shake once" with a pop on success. Calibrate asks the player to hold their playing position and tap **Set neutral**, followed by a one-second hold ring. |
| Practice | Pilot steers a ghost rocket through three rings (~10 s). Engineer shakes to fill two segments, selects Shield, and activates. A "PRACTICE" watermark shows inputs do not count. **Skip** appears after the first success. |
| Countdown | Full-screen 3-2-1-GO numerals, one second each, with a role reminder underneath ("Tilt to steer" / "Shake to charge"). |
| Match | Layout from Section 7.6. In the final 10 seconds the timer turns warning color and pulses once per second on every screen. |
| Paused | Dimmed, frozen arena with "Paused · Nova Engineer reconnecting" and a 15-second countdown bar. **Recalibrate** is available. On resume, show "Resuming in 3…". |
| Results | Headline "COMET WINS" in team color with the winning silhouette, or "DRAW" in neutral white. A per-team breakdown: checkpoints × 25, cores × 10, total. Primary **Rematch**, secondary **Swap roles**, and each player's ready state. |
| Interrupted | Neutral styling with no winner: "Match interrupted. A player couldn't reconnect." Single **Back to lobby** button. |
| Spectator (16:9 landscape) | Large centered arena with both crews' next gates marked. Side panels per team: crew names and roles, score, core pips, energy, ability state. Timer top center. An event ticker along the bottom, e.g. "NOVA rammed COMET · core dropped". |
| Errors | Full-screen card with what happened and what to do next, plus **Create room** and **Join room**. Used for room expiry and server restarts. |

**Motion setup failures**

- **Denied:** "Motion access was blocked. Reload the page and choose Allow. If it's still blocked, check your browser's motion settings." Offer **Try again** and **Watch instead**.
- **No readings within three seconds:** "We're not getting motion data from this phone." Offer **Try again** and **Watch instead**.

### 7.8 Feedback and animation

Timing rules:

- Local input feedback (tilt gauge, shake pop, selection ring) appears on the same frame as the input.
- UI transitions run 150–250 ms with ease-out. Event bursts last at most 600 ms.
- Animations never block input or delay authoritative state.
- Never shake the camera or screen on phones. Players are already moving their devices, and screen shake hurts readability.

| Event | Visual | Optional haptic / sound |
| --- | --- | --- |
| Shake registered | Energy segment pops; "+25" floats up | 30 ms vibration; charge blip |
| Shake ignored (rate limit or full) | No pop. A full meter glows with "FULL" | None |
| Ability selected | Tile fills with a 100 ms scale bump | Short tick |
| Activation succeeds | Button flash. Boost: doubled trail length and speed lines. Shield: hexagonal bubble around the rocket. Visible on every screen | Whoosh / hum |
| Activation fails | Button nudges sideways for 200 ms, and the reason shows for 1.5 s ("Not enough energy", "Cooldown 1.4s") | Soft error tone |
| Effect ending | Effect flickers during its final 0.5 s, then clears | None |
| Cooldown ready | Activate button refills with a single pulse | Short tick for engineer |
| Valid checkpoint | Gate flashes team color, "+25" pops near the HUD score, next gate starts pulsing | Chime |
| Core collected | Core streaks to a HUD pip; "+10" | Pickup blip |
| Core knocked out | Burst at impact. Victim's pip empties with a danger flash and "−10" | 80 ms vibration for victim crew |
| Dropped core | A draining ring shows its six-second lifetime. During the first second it shows a lock with the original owner's glyph | None |
| Shield blocks a drop | Bright spark and "BLOCKED" | Clank |
| Wall hit | Wall segment flashes and the rocket flickers briefly | 50 ms vibration for pilot |
| Bump | Small spark at the contact point | None |
| Match end | Frame freezes for 0.5 s with a "TIME!" banner, then results | Horn |

- **Haptics:** The Vibration API is not available in every target browser (notably Safari on iPhone). Feature-detect it and treat haptics as a bonus.
- **Sound:** Phones play short, low-volume UI sounds with a mute toggle in the HUD. The spectator display carries the main soundtrack and event sounds. Unlock audio from the same tap that enables motion, since browsers block autoplay without a user gesture.
- **Reduced motion:** When `prefers-reduced-motion` is set, replace nudges, bursts, and pulses with color and opacity changes and disable starfield parallax. Gameplay movement is unchanged.

### 7.9 UX copy and tone

The voice is short, energetic, and plain: a teammate calling the play, not a manual. In-match messages are imperatives of about six words or fewer. Use sentence case for body text and uppercase only for in-match banners. Errors never blame the player and always say what to do next.

| Situation | Copy |
| --- | --- |
| Home pitch | "Two rockets. Four phones. One winner." |
| Open lobby slot | "Tap to join" |
| Start blocked | "Waiting for Comet Pilot to get ready" |
| Calibration | "Hold your phone how you'll play, then tap Set neutral" |
| Engineer hint | "Shake to charge. Tilt to choose." |
| Not enough energy | "Need 25 more" |
| Selection locked | "Locked while charging" |
| Wrong orientation | "Turn your phone upright" |
| Pause | "Paused · Nova Engineer reconnecting" |
| Draw | "DRAW. Rematch?" |

### 7.10 Accessibility

- Team identity uses color, shape, pattern, and label together (Section 7.4).
- Contrast targets follow WCAG 2.2 AA: at least 4.5:1 for normal text and 3:1 for large text and essential graphics such as walls, gates, rockets, and meters.
- Touch targets are at least 48 × 48 CSS px; Activate is much larger.
- Render the HUD, scores, and controls as DOM elements over the canvas so they scale with text settings and are exposed to assistive technology. Use an `aria-live="polite"` region for lobby changes and results, and `aria-live="assertive"` for pauses and errors.
- All information conveyed by sound or haptics is also visible.
- Menu screens remain usable at 200% text size. The match HUD may use fixed sizes because of space constraints.
- Respect `prefers-reduced-motion` (Section 7.8).
- Physical motion is the core mechanic, so players who cannot tilt or shake a phone are limited to spectating or the development touch/keyboard controls (Section 6). Full WCAG conformance requires manual testing with assistive technologies and expert accessibility review; this specification does not claim it.

### 7.11 Implementation notes

- Keep design tokens in one source (for example, a shared constants module that also emits the CSS custom properties) so the DOM and canvas never drift.
- Scale the canvas by `devicePixelRatio`, capped at 2 for performance. Re-fit the course on viewport changes, letterboxing rather than cropping.
- Target 60 fps on mid-range phones. If frame time exceeds budget, drop glow and particles first; never drop state interpolation.
- Use the Screen Wake Lock API, where supported, to keep screens on during the lobby and match. Feature-detect it and re-acquire after the page becomes visible again.
- On the match screen, apply `touch-action: none` to the arena and controls, `overscroll-behavior: none` to the page, and `user-select: none` plus `-webkit-touch-callout: none` to controls.
- Draw art in code or as small SVGs. Target an initial load under about 500 KB compressed so phones join quickly on venue Wi-Fi.

## 8. Multiplayer and connection rules

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

## 9. Browser and technical requirements

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

## 10. Privacy, validation, and fairness

- Collect only a short display name and temporary session information. Do not request location, contacts, camera access, or financial information.
- Do not persist raw motion streams. Expire temporary room data with the room.
- Limit display-name length and render names as plain text. Validate message types, sizes, and values on the server.
- Check the WebSocket origin against the game deployment, enforce room/role access, and rate-limit room creation and input messages.
- Use server-controlled energy and cooldowns so a modified client cannot request unlimited actions.
- Browser-reported motion is not trustworthy proof of physical movement. Server limits reduce abuse but do not eliminate fabricated input; competitive anti-cheat is outside this casual MVP.
- Optional diagnostics should record timings and errors without collecting identifying information or raw sensor data.

## 11. Acceptance criteria

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
13. With the display set to grayscale, players can still tell the two rockets, scores, and ability states apart. In-match text and essential graphics meet the Section 7.10 contrast targets, and the engineer's selection lock, cooldown, and failed-activation reasons are visible as specified in Section 7.6.

Use small automated checks for scoring order, ability limits, pickups, timers, and role ownership. Use real-device tests for permissions, calibration, shaking, rotation, backgrounding, and connection recovery. Simulated sensor input cannot substitute for physical-device validation.

## 12. Build sequence

| Milestone | Deliverable | Exit condition |
| --- | --- | --- |
| 1. Prove the controls | Deployed sensor test with permission, calibration, tilt visualization, and shake detection, in the portrait orientation from Section 7.6. | Usable readings on the intended iPhone and Android devices, and a confirmed orientation choice for pilots. |
| 2. Prove shared control | A room with one rocket, a pilot, an engineer, and synchronized views. | Two phones reliably control the same rocket. |
| 3. Complete the game loop | Second rocket, course, checkpoints, cores, abilities, timer, and results. | A complete four-person match works. |
| 4. Handle interruptions | Readiness checks, reconnects, pause/resume, rematch, and input validation. | Failure paths behave according to the acceptance criteria. |
| 5. Prepare the presentation | Section 7 visual style and event feedback, optional spectator view, concise tutorial, and repeated real-device playtests. | Three consecutive matches complete on the demonstration setup. |

The first milestone is the main feasibility gate. Resolve sensor access and control feel before investing in detailed art or additional mechanics.

## 13. Scope after the MVP

| Feature | Reason to defer / design question |
| --- | --- |
| Six or eight active players | A natural extension is three or four rockets with two-person crews. Odd-sized groups require a separate, meaningful participation model. |
| Gunner role and larger crews | Requires aiming, projectiles, and balance testing. A shared cooldown alone does not make unequal crew sizes fair. |
| Additional courses and hazards | Add after the first course produces satisfying overtakes and close finishes. |
| Accounts, progression, cosmetics, and leaderboards | Do not improve proof of the core four-player experience. |
| Public matchmaking, persistent rooms, and production scaling | Need a larger reliability, moderation, and infrastructure scope. |
| 3D graphics, native apps, and elaborate physics | Not needed to deliver the specified browser experience. |

## 14. Risks and decisions to validate

| Risk | Response |
| --- | --- |
| Different sensor behavior between devices | Test early, use relative calibration, tune thresholds, and show a live setup check. |
| Weak venue connectivity | Test the deployed endpoint from the venue network and prepare a separately tested network option. |
| Engineer role feels repetitive | Keep shake bursts brief and make boost-versus-shield timing matter. Validate with players before adding extra actions. |
| Shaking disrupts ability selection | Freeze selection while a shake is detected and require a stable tilt to switch. |
| Players struggle to watch a moving phone | Keep the whole course readable and support a shared spectator screen. |
| Glow and particle effects drop frame rate on mid-range phones | Use pre-rendered glow, cap canvas pixel ratio, and shed effects before interpolation (Section 7.11). |
| Portrait grip feels wrong for pilots | Test grips in Milestone 1 and switch both roles to landscape together if needed (Section 7.6). |
| Cores dominate or barely affect outcomes | Adjust core values, pickup placement, and respawn times based on observed matches. |
| The judging rubric expects more than four active players | Confirm that expectation before finalizing submission scope; the proposed MVP explicitly supports four. |

## 15. Demo story

Open with: **“Two rockets. Four phones. Your teammate controls the one thing you need to win.”**

Have four participants join through the QR code and briefly demonstrate each role. Show a short live match with both ships visible on the spectator screen. Call attention to the physical controls, a coordinated boost, and the final score. End on the rematch screen so the complete experience is visible.

## 16. Technical references

Browser documentation reviewed for this specification:

- [MDN: Detecting device orientation](https://developer.mozilla.org/en-US/docs/Web/API/Device_orientation_events/Detecting_device_orientation) — motion/orientation events, HTTPS, permission gestures, and feature detection.
- [MDN: DeviceMotionEvent](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent) — available sensor values and coordinate differences across browsers.
- [MDN: WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) — persistent browser/server communication.

These references support the implementation approach. They do not establish that the game has been built or tested on the target phones.
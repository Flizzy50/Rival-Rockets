# Rival Rockets: AI Tool Rules

## Source of truth

- `rival-rockets-prd.md` is the single source of truth. Read the relevant sections before writing or changing any code.
- If code and the PRD disagree, follow the PRD. If the PRD is ambiguous or silent, ask before inventing behavior.
- If a change requires a rule change (scores, durations, costs, limits, copy, layout), update the PRD in the same change. Rule changes must also update the tutorial and results explanation (PRD Section 4).
- Gameplay numbers in the PRD are playtest starting values. Define them as named constants in one shared config module. Never hardcode them inline.
- Do not claim performance, device support, or test results the PRD lists as targets to validate.

## PRD map

| Topic | PRD section |
| --- | --- |
| Scope, four-player MVP boundary | 1 |
| Success targets | 2 |
| Player journey | 3 |
| Course, score, victory, cores | 4 |
| Pilot / Engineer controls, abilities | 5 |
| Required screens | 6 |
| UI/UX: style, colors, type, layout, feedback, a11y | 7 |
| Multiplayer, reconnect, authority | 8 |
| Browser/tech requirements | 9 |
| Privacy, validation, fairness | 10 |
| Acceptance criteria | 11 |
| Build sequence | 12 |
| Out of scope after MVP | 13 |

## Scope

- Exactly four active players (2 crews × Pilot + Engineer), plus optional spectators.
- Do not add gunner roles, more players, accounts, progression, matchmaking, databases, 3D graphics, native apps, or extra courses.
- Follow the build sequence in Section 12. Milestone 1 (sensor controls on real iPhone and Android) is the feasibility gate; do not build detailed art or extra mechanics ahead of it.
- Do not add features, abstractions, or configurability beyond what the PRD requires.

## Architecture rules

- The server is authoritative for the match clock, physics, checkpoint order, pickups, ability state, energy, cooldowns, and score. Clients send only normalized steering, charge events, and ability requests. Never send positions or scores from the client.
- Process raw sensor data on the client. Never persist or transmit raw motion streams.
- Use secure WebSockets for rooms, inputs, acks, and state. Keep messages small and rate-limited.
- Server simulation about 30 Hz, broadcasts about 15–20 Hz. Interpolate on the client. Make both rates constants.
- Rooms and matches live in server memory only. Rooms expire after 30 minutes of inactivity.
- Keep game rules (scoring, ability limits, pickups, timers, role ownership) in pure, side-effect-free modules so they are unit-testable without sockets or browsers.
- One source of design tokens shared by DOM and canvas (PRD 7.3, 7.11).

## Security and validation

- Validate every incoming message on the server: type, size, and value ranges. Clamp steering values.
- Verify team and role membership on every input. Spectators cannot send gameplay input or occupy roles.
- Enforce charge limits (25 energy, max 100, at most one charge per second), ability costs, and the shared cooldown on the server only.
- Reconnect tokens are private, per seat, and not derivable from the room code. One active connection per seat.
- Check the WebSocket origin. Rate-limit room creation and input.
- Render display names as plain text only (never as HTML). Enforce the name length limit.
- Collect only a display name and temporary session data. Never request location, contacts, camera, or financial data.
- Diagnostics record timings and errors only, with no identifying data and no raw sensor data.

## Motion input

- Request motion permission directly from a user tap. Feature-detect permission APIs.
- Do not mark a player ready until real sensor readings are confirmed. Permission denial or missing data must never count as ready.
- Use relative tilt from a per-player calibrated neutral, with a dead zone, smoothing, and a capped maximum. Never use compass heading.
- Shake detection: filtered bursts with a cooldown. Do not reward harder or continuous shaking.
- Freeze engineer ability selection during a detected shake and require a stable tilt to change it.
- Simulated or touch/keyboard input is for development and accessibility only. It does not validate the motion requirement.

## Gameplay rules to preserve

- Score = 25 × valid checkpoint crossings + 10 × cores currently carried.
- Checkpoints count only in order and forward. Backward, repeated, or skipped crossings give no points. Checkpoint points are never lost.
- Max 5 carried cores. A boosted ram on an unshielded opponent drops at most one core per boost. Shield prevents the drop.
- Dropped core: original owner waits 1 s to reclaim; it disappears after 6 s. Course cores respawn after 8 s.
- Abilities cost 50 energy, last 2 s, share a 3 s cooldown. Crews start with 50 energy. Failed activations spend nothing and show the reason.
- Match is 90 s. Higher score wins; equal scores are a draw.
- Disconnect or 3 s heartbeat timeout pauses and freezes clock, physics, cooldowns, and pickup timers. Seat is held 15 s, then resume after a 3 s countdown. If it expires, end as Interrupted with no winner.
- Rematch resets scores, cores, energy, timers, and ability state, alternates starting lanes, and respects role swaps.

## UI/UX rules (PRD Section 7)

- Style: neon vector arcade. Flat 2D shapes, dark navy space background, glow only on rockets, cores, next gate, and ability effects.
- Use only the defined color tokens. Team Comet = orange `#FF9F1C`, Team Nova = cyan `#2EC4F1`, cores = magenta `#E86BFF`. Dark text on team-colored buttons.
- Team identity always uses color + rocket silhouette + trail pattern + glyph + label. Never rely on color alone.
- Fonts: Space Grotesk (display) and Inter (body), self-hosted, `font-display: swap`. Use tabular figures for scores, timer, energy, and cooldowns. Avoid ambiguous characters (0/O, 1/I/L) in room codes.
- Phone layout is portrait: HUD bar, chase-camera arena, role panel (PRD 7.6). The arena fits the course width, holds the own rocket at a fixed screen height, and scrolls the course vertically; reduced motion, Watch, and spectator views show the full uncropped course. No page scrolling in matches. Show a "Turn your phone upright" overlay when rotated.
- Touch targets are at least 48 × 48 CSS px with at least 8 px spacing. Activate is at least 96 px tall. Respect safe-area insets.
- Local input feedback appears on the same frame. Never shake the screen or camera on phones. Animations never block input or delay authoritative state.
- Haptics and sound are optional. Feature-detect the Vibration API and unlock audio from the motion-enable tap. All information must also be visible. Provide a mute toggle.
- Honor `prefers-reduced-motion`.
- Render the HUD, scores, and controls as DOM over the canvas. Use `aria-live` as specified in 7.10.
- Use the PRD copy and tone (7.9): short, energetic, plain; errors say what to do next and never blame the player.
- Canvas: scale by `devicePixelRatio` capped at 2, letterbox full-course views and crop the chase camera only vertically, avoid per-frame `shadowBlur`, and shed glow and particles before dropping interpolation. Target 60 fps and an initial load under about 500 KB compressed.
- On match controls use `touch-action: none`, `overscroll-behavior: none`, `user-select: none`, and `-webkit-touch-callout: none`. Do not block pinch-zoom on menu screens.

## Code conventions

- Match existing project style and libraries. Check config files (`package.json`, etc.) for build, lint, and test commands before assuming any.
- Confirmed stack (do not change without asking the user):
  - TypeScript (strict) on the current Node.js Active LTS.
  - Client: Vite + vanilla TypeScript + HTML canvas. No UI framework.
  - Server: a single Node web service that serves the built client and, from Milestone 2, WebSockets via `ws` on the same origin.
  - Tests: Vitest. Keep rule and sensor logic in pure modules.
  - Local phone testing: Vite over HTTPS on the LAN via `@vitejs/plugin-basic-ssl`.
  - Hosting: Render web service, configured in `render.yaml`. Free instances spin down when idle and lose in-memory rooms; use a paid instance for demo day.
- Pin dependency versions exactly. Prefer well-known, maintained packages and flag unusual package names.
- Never hardcode secrets. Do not commit `.env` files.
- Never use native app, 3D, or database dependencies for the MVP.
- Code comments explain why, not what.

## Selected implementation stack (D1)

Planning decision recorded October 24, 2026, following the request to resolve D1. See [the comparison and deployment boundaries](docs/implementation-plan.md#d1-decision-typescript-without-a-ui-framework-deployed-on-render). This records the selected stack; scaffolding and deployment are separate tasks.

- Client: TypeScript, Vite, native DOM controls, plain CSS, and Canvas 2D. Use browser motion APIs and the native browser WebSocket client.
- Server: Node.js 24 LTS, Express for HTTP/static assets, and `ws` for WebSockets. One process owns the in-memory rooms and authoritative simulation.
- Tooling: one npm package and lockfile; Vite client builds, TypeScript type checking/server compilation, ESLint with typescript-eslint, and Vitest. Exact Node and package versions are pinned in `.node-version` and `package.json`.
- M1 deployment: one Render Web Service configured by render.yaml serves the built sensor-test client and /healthz over HTTPS. No game logic or WebSockets before the physical-device gate passes.
- M2 onward: one paid Render Web Service serves client assets and WSS on one origin. Use one instance and one Node process, with no horizontal autoscaling or clustering. Restart/redeploy recovery must follow PRD Section 8.
- Preserve the PRD's in-memory-only architecture. Do not add a database, Redis, a UI framework, or a separate production frontend host as part of this decision.

## Verification

- Run the project's build and lint after every change and fix errors before finishing.
- Add small automated tests for scoring order, ability limits, pickups, timers, and role ownership (PRD Section 11).
- Real-device testing is required for permissions, calibration, shaking, rotation, backgrounding, reconnection, and latency. Simulated sensors do not replace it. State clearly when something was not verified on a device.
- Check changes against the Section 11 acceptance criteria that they affect.
- Delete temporary files created during verification.

## Git

- Commit only when asked. Stage specific files, not everything.
- Never force-push, reset hard, or skip hooks without explicit permission.

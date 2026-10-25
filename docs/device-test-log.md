# M1 device test log

Record one row per device and scenario. Do not record names, device identifiers (serials, IMEI, IP or MAC addresses), or raw sensor samples. Simulated or desktop input does not count toward the M1 gate.

| Build / revision | Date | Device model | OS version | Browser version | Network (no identifying data) | Scenario / AC | Observed result | Measured value | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 working tree after a1a531a | 2026-10-24 | iPhone (model not recorded) | iOS 18.7 | Opera for iOS 6.7.3 (WebKit; UA reports OPT/6.7.3, not Safari) | LAN HTTPS, home Wi-Fi | Engineer test: setup, shake charge, selection | User reported everything works | Neutral 2.6°; orientation and motion 59 Hz; permission APIs present; vibrate no; wake lock yes; portrait-primary | Repeat in Safari; test Android Chrome |
| M1 working tree after a1a531a | 2026-10-24 | iPhone (model not recorded) | iOS 18.7 | Opera for iOS 6.7.3 (WebKit; UA reports OPT/6.7.3, not Safari) | LAN HTTPS, home Wi-Fi | Pilot test: setup, calibration, tilt steering in portrait | User reported everything works; portrait comfortable | Neutral 0.8°; orientation and motion 48 Hz; defaults unchanged (dead zone 4°, tau 80 ms, full scale 28°, shake 12 m/s²) | Repeat in Safari; test Android Chrome |

## M1 scenario checklist

Run each on iPhone (Safari) and Android (Chrome), over the LAN HTTPS URL and the Render URL.

- [ ] Permission allow: Enable motion prompts (where the browser asks) and live readings appear.
- [ ] Permission deny, then retry: denial shows the PRD copy; Try again from a tap recovers.
- [ ] No data: missing readings show the no-readings message after 3 s and never count as ready (AC3).
- [ ] Calibration: one-second steady hold sets neutral; movement restarts it.
- [ ] Tilt sign and comfort in portrait: tilting right turns right; grip is comfortable.
- [ ] Shake charge: one deliberate shake gives one charge; continuous shaking does not give more.
- [ ] Shake does not change selection: Boost/Shield stay put during shaking (AC4).
- [ ] Rotation overlay: landscape shows "Turn your phone upright"; steering goes neutral.
- [ ] Background / foreground: returning to the tab resumes readings without a jump.
- [ ] Wake lock: the screen stays on during the test.

# M2 device test log (shared control)

Agents did not run any of these checks; they need two physical phones and the deployed site. Do not record names, room codes, tokens, IP addresses, device identifiers, or raw sensor samples. Paste latency numbers from the debug panel's Copy readings.

| Build / revision | Date | Phone A (model, OS, browser) | Phone B (model, OS, browser) | Network (no identifying data) | Scenario | Observed result | Steer p95 send→ack | Charge p95 send→ack | Ability p95 send→ack | Render delay p95 | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | iPhone, iOS, Safari | Android, Chrome | | | | ms | ms | ms | ms | |

Target for comparison: p95 ≤ 150 ms (PRD 2). It's a target to measure, not a result.

## M2 scenario checklist

- [ ] Create a room on phone A, join from phone B by QR and by typed code.
- [ ] Claim Comet Pilot on one phone and Comet Engineer on the other; a second claim of the same seat is refused with the PRD copy.
- [ ] Both phones complete motion setup; the control test starts by itself and shows "CONTROL TEST · not a match".
- [ ] Pilot tilt turns the rocket on both screens in the same direction; neutral flies straight.
- [ ] Engineer shake adds 25 on both screens; continuous shaking adds at most one charge per second; shaking does not switch the ability (AC4).
- [ ] Engineer selection and Activate: Boost speeds up the rocket on both screens; Shield shows on both; failed activations show the reason and spend nothing (AC5).
- [ ] Watch from a third device or browser tab shows the same rocket without a seat or motion prompt.
- [ ] Rotate a phone: overlay appears, Pilot steering goes neutral, Engineer selection freezes.
- [ ] Turn off Wi-Fi on one phone for under 15 s: the rocket freezes, then resumes after reconnect with the same seat. Over 15 s: the seat reopens.
- [ ] Reload one phone within 15 s: the seat is reclaimed from session storage; motion setup runs again.
- [ ] On the deployed site, copy the debug panel summary after at least 2 minutes of flying: p95 send-to-ack for steer, charge, and ability, and render delay p95, against the 150 ms target.
- [ ] Per-IP limits on the deployed site behave per device (checks `RR_TRUSTED_PROXY_HOPS`).

# M3 device test log (game loop)

Agents did not run any of these checks; they need four physical phones (at least one iPhone in Safari and one Android phone in Chrome), the deployed site, and an optional fifth device to watch. Do not record names, room codes, tokens, IP addresses, device identifiers, or raw sensor samples. Paste latency numbers from the debug panel's Copy readings.

| Build / revision | Date | Comet Pilot (model, OS, browser) | Comet Engineer | Nova Pilot | Nova Engineer | Watch device (optional) | Network (no identifying data) | Scenario | Observed result | All phones agree on result? | Steer p95 send→ack | Charge p95 send→ack | Ability p95 send→ack | Render delay p95 | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | iPhone, iOS, Safari | Android, Chrome | | | | | | | | ms | ms | ms | ms | |

Target for comparison: p95 ≤ 150 ms (PRD 2). It's a target to measure, not a result.

## M3 scenario checklist

- [ ] Four phones join by QR or code and claim four unique seats; a fifth device watches.
- [ ] Each player completes motion setup and practice (pilot rings; engineer two charges, Shield, Activate). PRACTICE shows, Skip appears after the first success, and practice changes nothing in the lobby or match.
- [ ] The tutorial text matches PRD Section 4.
- [ ] With three players, an uncalibrated player, a disconnected player, or a player not Ready, the host's Start is disabled with the specific reason (AC2 foundation).
- [ ] 3-2-1-GO appears on all four phones with the role reminder.
- [ ] Both pilots steer with real tilt and both engineers charge with real shakes; each crew controls only its own rocket (AC3).
- [ ] Gates score only in order and forward; driving backward or circling one gate scores nothing (AC6).
- [ ] Cores: pickups, five-core cap, respawn, boosted ram drop, Shield block, owner lockout, dropped-core expiry; all phones agree on ownership and score (AC7).
- [ ] Walls slow the rocket and never trap it; bumps push without taking points.
- [ ] The chase camera keeps the own rocket at a fixed height; edge markers show the opponent, next gate, and cores off screen and are readable.
- [ ] Grayscale: the two rockets, scores, and ability states stay distinguishable (AC13 foundation).
- [ ] At 90 s every phone shows the same result and breakdown; a tie shows DRAW (AC8).
- [ ] Turn off Wi-Fi on one phone for under 15 s: the match freezes with "Paused · [Seat] reconnecting", then resumes. Over 15 s: all phones return to the lobby with "Match interrupted. A player couldn't reconnect." Disconnect during the countdown: everyone returns to the lobby.
- [ ] Rotate a phone mid-match: the overlay appears, Pilot steering goes neutral, Engineer selection freezes.
- [ ] During a four-phone match, record p95 send-to-applied-ack and render delay from the debug panel (AC12 foundation).
- [ ] Playtest note: with identical straight flight from the start lanes, both rockets reach the top core (420, 106) at the same instant, and the PRD tie rule leaves it uncollected. Note whether this feels wrong in play.

# M4 device test log (interruptions)

Agents did not run any of these checks; they need four physical phones and the deployed site. Use the M3 table columns above and put "M4" in the scenario. Same privacy rules.

## M4 scenario checklist

- [ ] Turn off Wi-Fi on one phone mid-match: every phone shows "Paused · [Seat] reconnecting", a dimmed arena, and a draining 15-second bar; the timer and cores stop.
- [ ] Turn Wi-Fi back on within 15 s: the phone reconnects, runs motion setup, and after Set neutral every phone shows "Resuming in 3…", then play continues from the same time and score.
- [ ] Disconnect a second phone during the pause: the pause continues, and the bar follows the earlier deadline.
- [ ] Disconnect a phone during "Resuming in 3…": the countdown stops and returns to Paused; it restarts in full once everyone is back.
- [ ] Stay offline past 15 s: seated phones show "Match interrupted" with Back to lobby, the Watch device shows the interrupted line, and the seat reopens.
- [ ] Reload a phone mid-match within 15 s: it reclaims the seat, runs setup, and the match resumes after the countdown.
- [ ] Background the browser mid-match, then return: the match pauses (heartbeat timeout) and resumes after setup.
- [ ] On Results, a non-host sees no Rematch button; the host's Rematch returns everyone to the lobby with Ready cleared and calibration kept.
- [ ] The next match starts with the lanes swapped (Comet lower).
- [ ] One crewmate taps Swap roles: "Waiting for teammate". Tapping again cancels. Both tap: they exchange seats, must redo setup and practice, and the host stays the same person.
- [ ] After a swap, reload a swapped phone: it reclaims its new seat (the new token was saved).

# M5 device test log (presentation)

Agents did not run any of these checks on phones. A desktop headless browser rendered Home, the phone-sized Watch view, the 1080p spectator view, TIME!, and Results during a scripted four-seat match; that confirms layout only, not device behavior. Use the M3 table columns above and put "M5" in the scenario. Same privacy rules.

## M5 scenario checklist

- [ ] Palette on real phones in a lit room: text, walls, idle and next gates, and cores are readable at arm's length (PRD 7.3).
- [ ] Grayscale (phone accessibility setting): the two rockets, scores, pips, and ability states stay distinguishable (AC13).
- [ ] Nova players see cyan role controls (energy meter, ability tiles, Activate); Comet players see orange.
- [ ] Enable motion also unlocks sound: charge blip, selection tick, error tone, cooldown tick on the engineer; gate chime, pickup blip, boost/shield sound for the own crew. Mute in the HUD silences them and the choice survives a reload in the same tab.
- [ ] Haptics on Android: 30 ms per charge, 80 ms on the victim crew's phones when a core is knocked out, 50 ms on the pilot's phone at a wall hit. iPhone shows the same events without vibration.
- [ ] Gate: flashes in team color, "+25" pops by the score, the next gate breathes. Core: streak up, "+10", pip pops. Boosted ram: burst, "−10", danger flash on the pip. Shield block: spark and "BLOCKED". Bump: small spark. Wall: wall flash and rocket flicker.
- [ ] All four phones and the spectator show the same events at about the same moment.
- [ ] At 90 s every screen holds with "TIME!" for about half a second, then Results.
- [ ] Spectator on a laptop or projector at 1080p: crew panels, large timer, and ticker are readable from about 4 m. Sound toggle turns the room's audio on.
- [ ] A phone or tablet watching in landscape shows no rotate overlay.
- [ ] Frame rate on the slowest presentation phone during a busy match (debug panel or browser tools). Record whether effects were shed.
- [ ] Initial load over venue Wi-Fi: record transferred bytes (build output is about 122 KB compressed for HTML, CSS, JS, and the four woff2 fonts; not measured on a network).
- [ ] Three consecutive complete matches on the demonstration setup (M5 exit).

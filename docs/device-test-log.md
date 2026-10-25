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

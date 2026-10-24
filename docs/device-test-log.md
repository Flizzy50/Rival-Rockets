# M1 device test log

Record one row per device and scenario. Do not record names, device identifiers (serials, IMEI, IP or MAC addresses), or raw sensor samples. Simulated or desktop input does not count toward the M1 gate.

| Build / revision | Date | Device model | OS version | Browser version | Network (no identifying data) | Scenario / AC | Observed result | Measured value | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | |

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

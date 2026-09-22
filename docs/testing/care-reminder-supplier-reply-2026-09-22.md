# SEDENTARY and HSW supplier reply — received 22 September 2026

## Source

The operator supplied Jett's reply to the earlier V52 firmware-specific question.
Screenshot: d23bc227-dceb-4dc9-99fc-90e93dc2378a.png; SHA-256:
`a59ad59b265aa51cad3a00276c9040e48be9057b6d4c55415682cb546262bb28`.
It displays 11:02 but no message date/timezone. Do not assign an exact UTC time.
The screenshot is not republished in the repository.

The question supplied these pilot VERNO labels:
- `C403H_RFHZ_V52_EN_750_V1.3_2025.03.10_18.29.29`
- `C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29`

The reply does not repeat those labels or claim a new live test on the pilot.

## Definitions supplied

1. The sedentary alarm triggers when no movement is detected during the set period.
2. In SEDENTARY,1,26, 1 means on, 0 means off, and 26 means 26 minutes.
3. The device makes sound when the sedentary alarm triggers.
4. HSW,0 disables the talking-time feature; HSW,1 enables it.

These resolve units and switch polarity. They do not prove physical execution.
Inactivity could explain the earlier silent waiting windows, but recorded
detected movement is missing, so that cause cannot be established retrospectively.

## Bounded operator actions

| Action | Body | Basis |
| --- | --- | --- |
| hsw-on | HSW,1 | Explicit supplier on definition. |
| hsw-off | HSW,0 | Explicit supplier off definition. |
| sedentary-on | SEDENTARY,1,26 | Existing literal and supplier's switch/minute definitions. |
| sedentary-off | SEDENTARY,0,26 | Uses the supplier-defined off flag and retains the documented interval; the complete off frame was not separately pasted by Jett. |

No arbitrary interval is accepted by the helper. Wire range/increments were not
supplied; the local UI's 10–200 in steps of 10 does not prove the wire range.
HSW bodies contain five ASCII bytes (0005); sedentary bodies contain fourteen
(000E). The gateway computes framing using the live session's protocol ID.
There is no SMS fallback or generic/customer dispatcher change.

The helper previews by default and sends once only with --send through the
existing authenticated loopback route. HSW and SEDENTARY do not replace clock
slots; REMIND still requires --confirm-replace-clocks. Old hsw-zero and
sedentary-example actions remain preview-only so earlier invocations do not
silently gain sending permission.

Every result retains hardwareAccepted:false and appliedStateVerified:false.
Handoff includes requestedAt; it does not prove receipt, execution or disable.
The switches may persist. Requesting off does not restore an unknown earlier
setting. Uncertain/offline sends never retry automatically.

## Checkpoint when the supplier reply was received (before the HSW test)

| Item | Established | Still pending |
| --- | --- | --- |
| REMIND | Once-only 02:05 clock sounded; entry disappeared after all-off. Operator corrected the original no-sound report. | Future cancellation, daily/weekly/day mapping, all slots, vibration, overlap and persistence. Customer UI/extended tests remain deferred. |
| SEDENTARY | Three local spoken exercise prompts; supplier defines inactivity, minutes, flag and sound. | Exact past prompt times, final local state/cleanup, remote on/off, permitted intervals, movement thresholds/reset/repeat, active hours, vibration, uploads and reboot persistence. |
| HSW | Supplier defines enable/disable. | Speech trigger, physical on/off, applied-state readback, effective disable/restoration and reboot persistence. |

The exact operator-reported sedentary phrase was "Sedentary reminder: do some
exercise!" Its three unknown gaps cannot establish a cadence. Location,
heartbeat and journey timestamps are not announcement timestamps.

Jett did not say HSW speaks immediately, on waking, or hourly. No such behavior
is promised. No wearer-acknowledgement or quiet-hour enforcement is established.
No live command was sent during this implementation. Customer flags stay off,
PR #118 remains draft, and PR #115 remains paused.

Follow the [Windows runbook](care-reminder-command-acceptance.md), one feature at a time.

## Subsequent pilot result — HSW wake-screen on/off passed

After the recorded HSW,1 handoff and reply, the operator confirmed that the
watch spoke the time during the instructed observation. They then reported
running the off command, waking the watch and hearing no spoken time.
This confirms the observed wake-screen on/off behavior on this pilot; it does
not add a supplier promise about every trigger, hourly speech or persistence.
The off command's CLI/downlink excerpt and exact physical timestamps were not
supplied. No additional command is needed just to repeat this successful trial.
See [the canonical result](../GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md#hsw-physical-wake-screen-result--22-september-2026).

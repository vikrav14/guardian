# PR #118: remaining V52 reminder commands

Status: REMIND once-only sound/visible clearing and local SEDENTARY speech were
observed. HSW passed the pilot wake-screen on/off test on 22 September; remote
SEDENTARY execution remains unverified. New supplier
definitions support bounded operator trials. PR #118 remains draft; customer
flags and automatic watch sync remain off. Wellness routines (#120/#127) and Family/Care medication reminders
using `TAKEPILLS` (#131) already reached main and are outside this acceptance.

## Supplier evidence

Sources supplied by the operator and confirmed applicable to V52:

- `2. V46-V48-V52 Communication Protocol(2).pdf`, II.20-21, printed page 7.
  SHA-256: `8f01881b9773f9ee762ceb2cc4dff9aa037abfa7a5540d6a723e1f4dd9161dbf`
  (identical to the previously supplied `(1)` copy).
- `3. V46-V48-V52 Communication Example(1).pdf`, pages 2-3.
  Source inventory SHA-256: `976b5721fbde52959a62d9f8975b9faf4bf6263e4b057d1eaa72950820e73e2b`.
- V52 datasheet and user guide advertise sedentary reminders, clock alarms and
  talking clock; the new reply resolves only the fields listed below.
- [Jett's reply received 22 September](care-reminder-supplier-reply-2026-09-22.md):
  source fingerprint, definitions, pending questions and pilot observations.

| Command | What the source establishes | What remains open | Current action |
|---|---|---|---|
| `REMIND` | Three slots; once-only sound and visible clearing observed. | Future cancellation, daily/weekly/day mapping, all slots, vibration and persistence. | Existing once/off operator trial; extended tests/UI deferred. |
| `SEDENTARY` | Supplier confirms 1 on / 0 off, 26 minutes, no detected movement and sound. | Range, motion/reset/repeat rules, active hours, physical remote on/off and persistence. | sedentary-on/off uses fixed interval 26; off uses the defined flag with interval retained. |
| `HSW` | Supplier defines HSW,0 off / HSW,1 on; pilot wake-screen speech followed by silence after off is operator-confirmed. | Readback, repeated trials, other triggers, restoration of an unknown prior setting and reboot persistence. | Wake-screen on/off passed on pilot; next focus is SEDENTARY. |

Example clock body:

```text
REMIND,07:00-1-1,08:10-1-2,05:30-0-3-1111111
```

This is 44 ASCII bytes (`002C`), matching the example capture. Always compute
the framing length; the protocol's separate II.20 example prints `0018`, which
does not match its body. Use Guardian's current session protocol ID, not the
supplier's example identity. No SMS fallback exists in the supplied SMS sheet.
The protocol describes Monday-to-Sunday selection, but the example's all-days
mask cannot independently prove ordering. Do not borrow the `TAKEPILLS` code's
Sun-to-Sat convention. Weekly customer scheduling remains gated.

## Operator procedures: HSW passed; SEDENTARY is next

Keep the existing gateway and ngrok running. These are client-script changes;
no gateway restart, customer flag, wellness change or AnyTracking connection
is required. Use a second PowerShell window:

```powershell
cd C:\Users\MSI\repos\guardian
git status --short
git fetch origin
git switch feat/v52-care-reminders
git pull --ff-only origin feat/v52-care-reminders
cd gateway

```

If Git refuses because of local work, preserve it and inspect the message;
do not reset/clean. The untracked news-review file is unrelated.

### Talking clock (completed pilot procedure; retained for repeat testing)

The operator has completed this wake-screen test successfully. Continue with
SEDENTARY below; no additional HSW command is required now.

Record any current talking-clock behavior/setting first. Keep the watch nearby
during an awake period with no call or other trial active. This trial finishes
with talking clock requested off; that is not restoration to an unknown prior
setting.

Preview, then explicitly send on once:

```powershell
node scripts/trial-care-reminders.js --imei 861397052547492 --action hsw-on
node scripts/trial-care-reminders.js --imei 861397052547492 --action hsw-on --send

```

Retain the outgoing HSW,1 line/reply if logged and actual local time. Listen
when enabling, then wake the screen normally and note any spoken time.
Waking is an observation to test, not a supplier-defined trigger. Do not hold
SOS or initiate a call. A brief silent window is inconclusive because the
speech trigger is still unknown; do not repeatedly resend or leave it enabled
waiting indefinitely.

Finish with off, then repeat the same ordinary observation:

```powershell
node scripts/trial-care-reminders.js --imei 861397052547492 --action hsw-off --send

```

If a reproducible speech trigger was found, check that it stops after off.
Otherwise record off handoff separately and leave effective disable unverified.
Report any speech continuing after off.

### Sedentary: documented 26-minute interval

Run separately after HSW cleanup. Record the original Open/Close/interval and
watch time. An off request does not restore an earlier enabled setting or
interval automatically.

Preview on/off:

```powershell
node scripts/trial-care-reminders.js --imei 861397052547492 --action sedentary-on
node scripts/trial-care-reminders.js --imei 861397052547492 --action sedentary-off

```

The off body is SEDENTARY,0,26, retaining the documented interval and changing
the supplier-defined flag. Do not substitute interval 0 or a guessed range.

Send once:

```powershell
node scripts/trial-care-reminders.js --imei 861397052547492 --action sedentary-on --send

```

Capture the actual time and outgoing frame/reply. Reopen the local menu and
record its displayed state; do not Save a rounded interval if the UI cannot
display 26. Record when handling ends because it can affect detected movement.

Observe up to 30 minutes during ordinary quiet activity. Record actual prompt
times, words, sound/vibration, movement/handling and interruptions. Do not remain
motionless beyond what is comfortable. A no-alert window is inconclusive.
Stop after a prompt or at the window limit, then send:

```powershell
node scripts/trial-care-reminders.js --imei 861397052547492 --action sedentary-off --send

```

Inspect the saved menu state. If remote off is ineffective, use the watch's
known Close/Save control and record the fallback. Observe during normal use for
later prompts. A reply or short silent window alone cannot prove effective
disable. Cadence, movement reset, range and reboot need separate evidence.

## Existing REMIND test (extended testing deferred)

This changes native clock alarms, not medication reminders. Check the watch's
three clock slots first. Only proceed when all three are empty or disposable:
the trial writes all three slots and does not provide a readback/restore of
existing clocks. Test during an agreed awake period with the watch nearby.

1. Update the branch and start the gateway in one PowerShell window:

   ```powershell
   cd C:\Users\MSI\repos\guardian
   git fetch origin
   git switch feat/v52-care-reminders
   git pull --ff-only origin feat/v52-care-reminders
   cd gateway
   npm start
   ```

2. In a second window, enter a time two or more minutes ahead **as displayed on
   the watch**, then preview. Avoid midnight for this first test. No credentials,
   Firestore access or live send occurs in preview mode.

   ```powershell
   cd C:\Users\MSI\repos\guardian\gateway
   $guardianClockTime = Read-Host 'Watch-local test time, HH:MM'
   node scripts/trial-care-reminders.js --imei 861397052547492 --action remind-once --time $guardianClockTime
   ```

3. After checking the proposed time and all three slots, explicitly send once:

   ```powershell
   node scripts/trial-care-reminders.js --imei 861397052547492 --action remind-once --time $guardianClockTime --send --confirm-replace-clocks
   ```

   Requires the existing local `ADMIN_API_KEY` and live watch TCP session.
   The key stays local. The tool uses the existing strict-admin downlink route;
   it creates no scheduled job or generic customer command. Never paste the key.
   `socket_handoff` confirms only a socket write. A bare reply does not establish
   that the alarm was stored, rang, or was acknowledged by the wearer.

4. Record the firmware, displayed watch time/timezone, exact outgoing frame,
   any incoming reply, visible slots, alarm time, sound/vibration/display and
   how dismissal behaves. The parser already recognizes bare replies as server
   command echoes; absence of a normal gateway reply log is not a negative
   hardware result. Use a raw capture if reply evidence is required.

5. Clean up the trial clocks, then inspect all slots on the watch:

   ```powershell
   node scripts/trial-care-reminders.js --imei 861397052547492 --action remind-off
   node scripts/trial-care-reminders.js --imei 861397052547492 --action remind-off --send --confirm-replace-clocks
   ```

   This uses the documented off bit in all three slots. Whether firmware removes
   the slots or merely disables them must be observed. If disabling is not
   effective, stop the test and disable the trial alarms using the watch UI.
   Timeouts and errors are not safe-to-retry signals: inspect the watch first.

## Legacy example previews

```powershell
node scripts/trial-care-reminders.js --imei 861397052547492 --action sedentary-example
node scripts/trial-care-reminders.js --imei 861397052547492 --action hsw-zero
```

`--send` is still rejected for these legacy actions. Use the explicit on/off
actions above for sends. Old previews do not silently gain permission; no
arbitrary interval or automatic restore is implemented.

## Closure criteria

| Item | Required evidence before closing as complete |
|---|---|
| `REMIND` | Once/daily/weekly behavior; Monday and Sunday mapping; change/off of each slot; reboot/reconnect; sound/vibration and overlaps with `TAKEPILLS`; no unsupported wearer-acknowledgement claim. |
| `SEDENTARY` | Polarity/units are supplier-defined; verify range, timed execution, activity reset, quiet hours, effective disable and reboot. |
| `HSW` | Pilot wake-screen on/off is confirmed; verify repeatability, other triggers, applied-state readback and reboot persistence before wider acceptance. |
| Customer activation | Accessible configuration, wearer-visible schedules, enforceable quiet hours/rate limits, correct Care entitlement and audit, second production-equivalent V52 acceptance. Separate reviewed rollout. |

The current trial does not prove quiet hours for persistent native alarms. The
backend quiet-hours predicate only evaluates a sync attempt; it cannot silence
an alarm already stored on a watch. Resolve this before automatic scheduling.

No hardware boxes are checked by unit tests, CI or a successful socket write.
If a command remains unsupported, record an explicit product decision and
retain its disabled state rather than marking it proven.

## Result record

- Watch/firmware and date: pending
- Original three-clock state and displayed local time: pending
- Trial action, exact outgoing frame, socket result: pending
- Incoming reply (or not captured): pending
- Observed display/audio/vibration and timing: pending
- Change/off result and final three-clock state: pending
- Persistence/reconnect, weekly mapping and overlap: pending
- Supplier definitions: received 22 September; see linked source record.
- Existing observations: REMIND once-only sound/visible clearing; three local SEDENTARY announcements with unknown timing.
- HSW wake-screen on/off: **passed on pilot, operator-confirmed 22 September**; see the canonical evidence below.
- Remote SEDENTARY trial: **not yet performed**.
- Full customer/hardware acceptance: **incomplete**.

See [the canonical HSW result](../GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md#hsw-physical-wake-screen-result--22-september-2026) for transport evidence, the operator's observations and the remaining limits.

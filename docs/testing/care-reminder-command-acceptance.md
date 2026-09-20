# PR #118: remaining V52 reminder commands

Status: software preparation only; no real-watch result for these commands has
been recorded. PR #118 remains draft. Customer flags and automatic watch sync
remain off. Wellness routines (#120/#127) and Family/Care medication reminders
using `TAKEPILLS` (#131) already reached main and are outside this acceptance.

## Supplier evidence

Sources supplied by the operator and confirmed applicable to V52:

- `2. V46-V48-V52 Communication Protocol(2).pdf`, II.20-21, printed page 7.
  SHA-256: `8f01881b9773f9ee762ceb2cc4dff9aa037abfa7a5540d6a723e1f4dd9161dbf`
  (identical to the previously supplied `(1)` copy).
- `3. V46-V48-V52 Communication Example(1).pdf`, pages 2-3.
  Source inventory SHA-256: `976b5721fbde52959a62d9f8975b9faf4bf6263e4b057d1eaa72950820e73e2b`.
- V52 datasheet and user guide advertise sedentary reminders, clock alarms and
  talking clock; they do not resolve the missing wire-field definitions below.

| Command | What the source establishes | What remains open | Current action |
|---|---|---|---|
| `REMIND` | Three clock slots, `HH:MM-on/off-frequency`; 1 once, 2 daily, 3 weekly plus seven-bit mask. Bare `REMIND` reply. | Exact firmware execution, replacement, disabling, local time, weekly day ordering and persistence. | Operator-only once/off trial available; preview by default. |
| `SEDENTARY` | Example page 2 sends `SEDENTARY,1,26`, receives `SEDENTARY`. Caption: set time interval. | Meaning of `1`, units/range of `26`, disable/restore command, activity reset and active-hour behavior. | Preserve exact literal as preview; sending blocked. Do not label `26` minutes or invent `SEDENTARY,0,...`. |
| `HSW` | Protocol II.21 and example page 3 both send `HSW,0`, receive `HSW`. | Protocol says the tracker says the time; example calls it a switch, guide says on/off. Polarity, persistence, readback/restore and `HSW,1` are unconfirmed. | Preserve `HSW,0` as preview; sending blocked pending clarification. |

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

## First controlled REMIND test on Windows

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

## Preview the unresolved supplier examples

```powershell
node scripts/trial-care-reminders.js --imei 861397052547492 --action sedentary-example
node scripts/trial-care-reminders.js --imei 861397052547492 --action hsw-zero
```

`--send` is rejected for both. There is no guessed polarity, timer range,
alternate payload or automatic restore command in this tool.

## Closure criteria

| Item | Required evidence before closing as complete |
|---|---|
| `REMIND` | Once/daily/weekly behavior; Monday and Sunday mapping; change/off of each slot; reboot/reconnect; sound/vibration and overlaps with `TAKEPILLS`; no unsupported wearer-acknowledgement claim. |
| `SEDENTARY` | Supplier field definitions and supported off/restore, then timed watch test, activity reset, quiet-hour behavior, disable and reboot. |
| `HSW` | Supplier clarification of one-shot versus persistent switch, both supported states and restore, then audible/visible behavior and persistence on the watch. |
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
- Supplier clarification for `SEDENTARY` / `HSW`: pending
- Real-device acceptance: **not yet performed**

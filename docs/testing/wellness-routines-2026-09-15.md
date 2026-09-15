# Wellness routines — 15 September 2026

Status: guarded private-pilot implementation; automatic temperature and physical
wearing detection are not accepted on the exact watch yet. The operator confirmed
the temperature preview displayed the saved result, not an automatic capture.

## Original supplier documents rechecked

ReachFar V46/V48/V52 Communication Protocol (2021-12-20), supplied 8 September,
and its companion Communication Example were reopened. Original hashes are in
`docs/services/wifi-home-supplier-validation.md`.

- Protocol p9, II.32: bodytemp2 requests one temperature for BT=2 firmware.
- Protocol p9, II.33: bodytemp,enabled,hours controls cyclic temperature for BT=2;
  enabled is 0/1; interval range is 1–12 whole hours.
- Protocol p9, II.34: BTTIMESET is a separate TM=1 mode. It remains blocked.
- Protocol p8, II.26: hrtstart uses seconds. Existing five-minute heart/BP/oxygen
  pilot evidence does not validate long 8h/12h cadence or battery impact.
- Protocol p13 labels bit 3 wearing status; Example p5 explicitly calls bit 3
  unused, and p4 leaves it blank. Protocol p6 describes REMOVE; Example p2
  describes REMOVESMS. Neither proves positive worn/restored status on this watch.

This corrects earlier statements that temperature command forms were absent.
Firmware conditions and real-device behaviour remain to be tested. It also
strengthens the unresolved wearing conflict in PR #112: constant-zero samples
while worn/removed/worn-again must not be accepted or inverted.

## Selected routine

| Selection | Heart/BP and observed paired oxygen cycle | BT=2 temperature cycle |
|---|---|---|
| Manual | hrtstart,0 | bodytemp,0,12 |
| Gentle rhythm | hrtstart,43200 | bodytemp,1,12 |
| Balanced rhythm | hrtstart,28800 | bodytemp,1,8 |

Manual requests cycle stops; the watch's manual measurement control remains.
Intervals may include overnight readings. Quiet hours, exact clock times and
next-reading predictions are not implemented. Steps continue independently.

Private-preview users on all editions can open Wellness routine from the card.
Only three preset IDs, the caller's ID and a server timestamp can be submitted.
Backend status distinguishes blocked, sending, awaiting readings, partial failure,
stop sent and stop pending offline. Handoff never means confirmed watch behaviour.

Automatic start requires the configured pilot, request/ingestion/routine flags,
current linked active account, named unexpired preview grant, wearer consent,
one live session, that session's CONFIG BT:2 and fresh accepted wearing evidence.
Unknown/removed wearing blocks start. This pilot therefore remains paused until
wearing acceptance is resolved. Never change acceptance flags to bypass that gate.

A one-watch loop uses a durable lease/checkpoint and pre-send rechecks. Polls do
not repeatedly reset intervals. Removal/unknown/expiry/revocation requests stops
for previously started cycles. A partial start needs stops and a new user request.
Restart/reconnect cannot reuse old wearing or CONFIG proof. The offline watch
may retain a native schedule: connected stopping is best effort, up to the
20-second control poll plus I/O after evidence changes. Existing data-quality
gates separately exclude unknown/off-wrist values from customer analytics.
Manual with unknown BT sends only the heart stop and says temperature control
is unconfirmed. Stopping the gateway does not stop the watch's native schedules.

## Next watch check

Pull the branch and restart the gateway with the existing ingestion/request and
consent settings. Keep all exact-device acceptance flags unverified.

```powershell
npm run wellness:routine
```

This reads the running gateway's current-session BT/TM flags and routine status;
it sends nothing and prints no numerical readings or raw CONFIG fields. If BT is
2 and connected is true, wear the watch and run:

```powershell
npm run wellness:routine -- --request-temperature
```

Do not press the watch's measurement button during this comparison. Observe
whether measurement starts and a fresh btemp2 upload reaches Wellness. This sends
only documented bodytemp2, with a two-minute local cooldown, strict admin/pilot
scope and current consent. Result data remains unverified; handoff is not success.

If BT is absent, wait for CONFIG on a new watch connection and share the redacted
status. Ask the supplier how this firmware advertises its mode if it never sends
CONFIG. Do not infer BT=2 from a btemp2 value or change firmware configuration.

To inspect the app controls: deploy this branch's Firestore rules (no new index),
retain a valid private-preview grant and Flutter preview flag, and enable
WELLNESS_ROUTINE_PILOT_ENABLED for the running gateway. Preferences persist but
automatic start stays paused while wearing is unverified.

Remaining hardware acceptance: resolve the bit-3 contradiction; identify positive
worn/restored evidence; prove temperature single/cycle/stop on BT=2; verify 8h/12h
cadence, reboot/offline/failure and battery impact. Repeat wearing tests only after
a documented signal/configuration change. No REMOVE or REMOVESMS is sent by this
implementation. Customer reports, alerts and AI conclusions remain disabled.

Tests cover command maps, firmware/wear/access preconditions, duplicate polls,
offline stops, partial handoffs, restart, lease/checkpoint failure and changed
preflight evidence. Rules tests reject unauthorized/forged requests and status
writes. Flutter tests cover choices, pending/error feedback, stale status and
narrow layouts with enlarged text.

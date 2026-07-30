# Guardian

A GPS safety app for families in Mauritius. A wearable pendant (V28C, Shenzhen
Reachfar — GT06-family protocol) is worn by a child, an elderly relative, or
anyone who needs tracking and an SOS button. A Flutter app lets a "guardian"
see the pendant's location, get alerts, and manage everything from one place.

## Architecture

- `apps/mobile/` — Flutter app. Android + Web only, **no iOS target exists**.
  Firebase Auth + Firestore + FCM push. `lib/services/guardian_services.dart`
  holds most Firestore read/write logic; `lib/screens/` is one file per
  screen.
- `gateway/` — Node.js TCP server. Decodes the GT06 protocol from the pendant
  (`src/protocol/gt06.js`), writes to Firestore, evaluates geofences
  (`src/geofence.js`), sends push/SMS/WhatsApp notifications (`src/push.js`,
  `src/notify.js`), sends SMS commands back to the pendant (`src/commands.js`),
  and runs a Claude-powered WhatsApp assistant (`src/assistant/`).
- `firestore/` — `SCHEMA.md` (source of truth for the data model) and
  `rules.example` (the real security rules — deploy via `firebase.json`).
- `docs/reference/` — vendor PDFs (V28C datasheet, SMS command reference).
  These are the *only* commands we have vendor confirmation for.

## Where things are tracked

- **GitHub Issues** (https://github.com/vikrav14/guardian/issues) — one issue
  per feature or bug, evidence-based (compiled from a full code audit, not a
  roadmap guess). Labels: `status:built|designed|hardware-ready|concept`,
  `tier:basic|family|care|tbd`, `area:tracking|safety|ai|communication|family|admin`,
  `type:bug`. Re-run `scripts/setup-github-issues.sh` to add new items — it's
  idempotent and skips issues that already exist by title.
- **GitHub Wiki** — plain-language, QA-facing docs (no code reading required):
  Home, How the app works, Feature Map (Mermaid diagram), What's
  working/designed/idea, Known issues, Glossary. **Update this whenever a
  push changes what's built, broken, or fixed** — it exists so QA doesn't
  waste time on things that don't work yet or re-report things already known.
  It drifts easily; don't let it.

## Hard rule: never fabricate hardware commands

The pendant's SMS command set is only partially documented. `docs/reference/
Switch-Server-SMS-Commands.pdf` (the actual vendor doc for this exact device)
covers: server switch, SOS numbers, center number, status check, APN, IMEI
change. That's it.

`voice_monitor` (`monitor,<phone>#`) and `ring_to_find` (`find#`) in
`gateway/src/commands.js` are borrowed from a third-party community source
(github.com/matthiasmo/RF-V28) documenting a *related but different* hardware
model (RF-V28, not this V28C) — flagged unverified in code comments and in
the app UI. Treat them as unconfirmed until tested against real hardware.

Remote photo capture, pill reminders, and pedometer/step-count have **no**
known command syntax or protocol packet format anywhere we could find. Do not
guess at these — verify with the vendor first. See GitHub issues #28, #29,
#12.

## Known gaps (see GitHub issues for the full, current list)

- No real device-onboarding flow — every new account auto-links to one
  hardcoded demo IMEI (`AuthService.demoImei` in `auth_service.dart`).
- `gateway/.env`'s `WRITE_LOCATION_HISTORY` must be `true` for route history
  to have any data (defaults to `false`).
- WiFi safe-zone matching has real, tested evaluation logic
  (`gateway/src/geofence.js`), but the GT06 decoder never populates a WiFi
  SSID field from real device packets — the feature is structurally dead in
  production until that decoding exists.
- Family invites are one-directional: the acceptor links to the inviter's
  device(s), but the inviter's own `familyMembers` list is never updated with
  the acceptor. Known bug, not yet fixed (issue #62).
- No real payment/billing — the subscription tier is a Firestore field with
  no processor behind it, display-only.
- Only a small number of strings are localized (nav labels, emergency
  contacts, a few settings); most screens stay in English regardless of the
  selected language.
- The gateway currently only runs locally (a developer's machine). A real
  pendant talks over cellular data and cannot reach `127.0.0.1` — it needs to
  be exposed (tunnel for testing, real hosting for production) before real
  hardware can be linked.
- "Listen in" (voice monitoring) gives the wearer no on-device indication
  they're being listened to — a real privacy/consent question, not just a
  testing caveat. Worth a deliberate decision before this is used on a real
  person.
- **Ring/locate command (`find#`) — device firmware limitation**: Vendor docs
  claim device rings for 1 minute then auto-stops, but real V28C hardware does
  NOT auto-stop. Device rings continuously with looping tune until physically
  interrupted (SOS button or repeated button presses to let tune complete).
  No remote protocol command stops the ring. Server sends `CR` after 60s as
  workaround but device ignores it. Not recommended for production until vendor
  provides firmware fix or confirmed stop mechanism. Tested on real hardware
  (Dexter, Jeshna).

## Dev setup

- `docs/FLUTTER_SETUP.md`, `docs/FIREBASE_SETUP.md` — one-time setup steps.
- Flutter (`apps/mobile/`): `flutter test`, `flutter analyze`.
- Gateway (`gateway/`): `npm test` (Node's built-in `node --test`),
  `npm run simulate` (fake pendant near Quatre Bornes), `npm start`.
- The alerts query needs a Firestore composite index (`imei` + `createdAt`
  descending) — defined in `firestore/firestore.indexes.json`, deployed via
  `firebase deploy --only firestore:indexes` or the console link in the
  error message. Get the sort direction right (descending) or it silently
  creates the wrong index.

## Conventions

- Security: every Firestore read is scoped through `linkedTo(imei)` (checks
  `users/{uid}.linkedImeis`) in `firestore/rules.example` — don't loosen this.
  Client queries filter by `linkedImeis` too (Firestore rejects unscoped
  queries against these rules), so new screens need to follow the same
  pattern as `DeviceService.watchLinkedDevices()`.
- SMS/WhatsApp notifications to emergency contacts are intentionally
  *narrower* than push notifications to guardians (SOS/fall/exit only, not
  enter/low-battery) — this is deliberate (`shouldNotify` vs `shouldSms` in
  `gateway/src/firestore.js`), not a bug. Don't "fix" it without checking
  here first.
- Tests use `fake_cloud_firestore` + `firebase_auth_mocks` on the Flutter
  side (real Firestore-shaped fakes, no platform channels needed) and
  `node:test` on the gateway side — no other test frameworks.

## Protocol Reference: V28C → V52 Migration

All pendants use the ReachFar GT06-family ASCII protocol (same packet format,
shared command structure). However, **status bit assignments differ between
versions** — this is critical for alarm classification.

### Device Status Bits (Alarms)

The device reports alarms as a 32-bit hex value (last field in AL_LTE packets).
Bit positions **are not interchangeable** across device versions:

**V28C bits (from Communication Example doc):**
| Bit | Meaning |
|-----|---------|
| 0 | Low battery status |
| 15 | Vibrate alert |
| 16 | SOS alarm |
| 17 | Low battery alarm |
| 20 | Bracelet removal alert |
| 21 | Fall alert |

**V52 bits (from Communication Protocol doc, section 5):**
| Bit | Meaning |
|-----|---------|
| 0 | Low battery status |
| 3 | Wear GPS watch status |
| 16 | SOS alarm |
| 17 | Low battery alarm |
| 18 | Out-of-fence alarm |
| 19 | Enter-fence alarm |
| 20 | Remove bracelet alarm |
| 22 | **Fall alert** |

**Bit 22 (V52) vs Bit 21 (V28C)**: The vendor's V52 Communication Example doc
lists bit 22 as both "Fall alarm" and "Heart rate abnormal alarm" — this is a
direct contradiction in the manufacturer's own docs. We align with V52 protocol
section 5 (**bit 22 = fall**) for forward compatibility with V52 devices. This
is implemented in `gateway/src/protocol/gt06.js:327`.

### Commands: TCP vs SMS Routing

- **TCP-only commands** (`ring_to_find`, fall detection, medication reminders):
  require a live device connection. No SMS fallback — fail clearly if device
  offline.
- **SMS commands** (center number, SOS slots, status check): work when the device
  has a SIM and data coverage, even without an active TCP session.

See `gateway/src/commands.js` for the `TCP_ONLY_TYPES` set and dispatch logic.

### Known Unverified Commands

`voice_monitor` (`monitor,<phone>#`) and `ring_to_find` (`find#`):
- Borrowed from third-party RF-V28 docs (github.com/matthiasmo/RF-V28).
- **Not** in ReachFar's official V28C SMS command sheet.
- Flagged as unverified in code comments and app UI.
- Tested and confirmed working on real V28C hardware (Dexter, Jeshna).

### Open Items Before Full V52 Migration

1. **Fall alarm bit conflict**: confirm V52 bit 22 (vs 21) against real hardware.
2. **MONITOR command**: verify whether it requires a phone number argument on
   your firmware version.
3. **Photo capture**: resolve which command set (`rcapture`/`img` vs `PIC`+FTP)
   your V52 units implement.
4. **Geofence enter/exit bits**: V52 defines separate bits (18/19). Confirm your
   devices use this encoding.
5. **SOS contact expansion**: V52 supports 3 slots (SOS1, SOS2, SOS3) vs V28C's
   single slot — app/backend must handle this schema change.

For full technical details, see `/desktop/guardian-v28-v52-protocol-reference.md`
(built from manufacturer PDFs, SMS command guides, and V52 datasheet).

# Guardian

A GPS safety app for families in Mauritius. Guardian supports one production
hardware model: the Shenzhen ReachFar **V52 watch**. It is worn by a child, an
elderly relative, or anyone who needs tracking and an SOS button. A Flutter
app lets a guardian see honest location provenance, receive alerts and manage
the family service.

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
- `docs/reference/` — raw vendor PDFs gathered during evaluation. Older-model
  files are historical evidence only and must never override V52 captures,
  acceptance results or V52-only tests.

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

The V52 command set is only partially proven. `gateway/src/commands.js` must
contain V52 syntax only. Keep two evidence levels separate:

- **Live-proven V52 SMS provisioning:** center number, SOS1 and `ts#`.
- **Documented V52 SMS provisioning:** SOS2/SOS3 use the same slot syntax but
  still need explicit real-device acceptance.
- **Documented V52 TCP data commands:** `MONITOR`, `FIND`, `FALLDOWN`, `LSSET`,
  `TAKEPILLS` and `UPLOAD`. These require a live V52 session and must not gain
  a guessed SMS fallback. The supplied documents conflict between bare
  `MONITOR` (master-number callback) and `MONITOR,<phone>`; neither variant is
  live-proven. A documented command is not a product promise until its
  real-device acceptance passes.

Never import older-model alarm bits, shortened packet layouts or community
SMS commands into production. Never change APN or IMEI from an example value.

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
- "Listen in" (voice monitoring) may give the wearer no on-device indication
  they're being listened to — a real privacy/consent question, not just a
  testing caveat. The old app and generic Firestore command paths are blocked;
  keep the replacement audio-check-in entry point hidden until deliberate
  consent, hardware, carrier and legal acceptance is complete.
- `MONITOR` and `FIND` have V52 protocol syntax and correct TCP framing, but
  remain hardware-acceptance items. Do not claim call completion, audible-ring
  duration or remote stop behaviour without a real V52 result.

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

## V52 Protocol Contract

Frames use `[CS*protocolId*LEN*command,data...]`. The tracker state is the
eight-character hexadecimal value at fixed argument index 15 in the full V52
LTE layout. It is not the last LTE-tail value.

| V52 bit | Meaning |
|---------|---------|
| 16 | SOS alarm |
| 17 | Low-battery alarm |
| 18 | Safe-zone exit |
| 19 | Safe-zone entry |
| 20 | Bracelet removal |
| 22 | Fall alarm |

`gateway/src/protocol/gt06.js` deliberately rejects bit 21 as fall and rejects
shortened legacy alarm layouts. Do not weaken these guards to accommodate a
mixed-generation example document.

### Commands: TCP vs SMS Routing

- **TCP-only V52 commands:** live-proven administrator-only `PHBX`, plus
  customer-dispatchable documented `FIND`, fall settings, medication reminders
  and reporting interval. A live connection is mandatory. The two documented
  MONITOR variants remain admin-acceptance builders only and are excluded from
  the generic dispatcher. PHBX is an incoming allowlist on Guardian's current
  SIM; never promise wearer-originated calls.
- **Live-proven SMS provisioning:** center number, SOS slots and `ts#` status.

See `gateway/src/commands.js` for the `TCP_ONLY_TYPES` set and dispatch logic.

### Remaining V52 Acceptance Items

1. Trigger a real fall and confirm bit 22 plus frozen event-location delivery.
2. Resolve bare `MONITOR` versus `MONITOR,<verified phone>` callback behavior,
   wearer indication, consent UX and carrier charging on the real V52.
3. Verify `FIND` sound, duration and stop behaviour on the real V52.
4. Test a canonical medication reminder end-to-end on the watch.
5. Tune safe-zone hysteresis using outdoor/indoor V52 walks; approximate
   Wi-Fi/LBS observations must not create false boundary transitions.
6. Repeat PHBX provisioning, approved incoming calling and unknown-caller
   rejection on a second production V52/SIM; confirm replacement/removal with
   ReachFar before customer contact management is enabled.

Record results in `docs/GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md`. A vendor claim
or unit test alone never marks a hardware promise Proven.

See `docs/GUARDIAN_V52_COMMAND_EVIDENCE.md` for the command-by-command evidence
ledger and exact transports.

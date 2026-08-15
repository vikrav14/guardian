# Guardian

Premium personal GPS safety platform for families in Mauritius — elderly care, school transit monitoring, and outdoor SOS.

**Repo:** https://github.com/vikrav14/guardian

## Documentation

- [CONTEXT.md](CONTEXT.md) — product vision, hardware, architecture, features
- [firestore/SCHEMA.md](firestore/SCHEMA.md) — Firestore collections and fields
- [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md) — create Firebase project + wire the gateway
- [docs/FLUTTER_SETUP.md](docs/FLUTTER_SETUP.md) — Flutter map dashboard + Firebase Web config
- [docs/GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md](docs/GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md) — V52 real-device release evidence
- [docs/GUARDIAN_V52_COMMAND_EVIDENCE.md](docs/GUARDIAN_V52_COMMAND_EVIDENCE.md) — exact V52 commands, transports and proof levels
- [docs/GUARDIAN_LOCATION_PROVENANCE.md](docs/GUARDIAN_LOCATION_PROVENANCE.md) — V52 GPS/Wi-Fi/LBS source policy
- [docs/reference/](docs/reference/) — raw vendor references; V52 evidence takes precedence over older-family material

## Repository layout

```
guardian/
  CONTEXT.md
  firestore/          # Schema + example security rules
  gateway/            # Node.js GT06 TCP listener → Firestore
  apps/mobile/        # Flutter map dashboard (Firestore live)
```

## Quick start — gateway

```bash
cd gateway
cp .env.example .env   # fill in Firebase project + credentials path
npm install
npm start
```

In a second terminal (no hardware needed):

```bash
cd gateway
npm run simulate
```

Listens on TCP port **9000** for ReachFar V52 ASCII packets (or the simulator).

See [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md) to connect a real Firebase project.

## Stack (current)

| Layer | Tech |
|-------|------|
| Device protocol | GT06 over TCP |
| Gateway | Node.js |
| Backend data | Firebase Firestore + Auth |
| Mobile (next) | Flutter |

## License

TBD

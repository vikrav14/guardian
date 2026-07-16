# Guardian

Premium personal GPS safety platform for families in Mauritius — elderly care, school transit monitoring, and outdoor SOS.

**Repo:** https://github.com/vikrav14/guardian

## Documentation

- [CONTEXT.md](CONTEXT.md) — product vision, hardware, architecture, features
- [firestore/SCHEMA.md](firestore/SCHEMA.md) — Firestore collections and fields
- [docs/reference/](docs/reference/) — V28C datasheet + SMS server-switch commands (PDFs)

## Repository layout

```
guardian/
  CONTEXT.md
  firestore/          # Schema + example security rules
  gateway/            # Node.js GT06 TCP listener → Firestore
  apps/mobile/        # Flutter app (next milestone)
```

## Quick start — gateway

```bash
cd gateway
cp .env.example .env   # fill in Firebase project + credentials path
npm install
npm start
```

Listens on TCP port **9000** for GT06 packets from GPS pendants.

## Stack (current)

| Layer | Tech |
|-------|------|
| Device protocol | GT06 over TCP |
| Gateway | Node.js |
| Backend data | Firebase Firestore + Auth |
| Mobile (next) | Flutter |

## License

TBD

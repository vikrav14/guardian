# Journey hybrid route presentation

Guardian keeps the completed journey document as the authoritative evidence.
Google-derived geometry and nearby places live in the optional, expiring
`devices/{imei}/journeys/{journeyId}/presentations/google_v1` document.

## Display contract

- GPS sections are blue and remain evidence-backed.
- Google sections are purple and appear only between two reliable GPS fixes
  when a Routes alternative passes endpoint, elapsed-time, detour, and any
  available approximate-observation checks.
- The map source key contains only `GPS` and, when used, `Google`.
- A nearby business is phrased conservatively: `Near Super U Grand Baie`, not
  `At Super U`. Nearby-place matching runs only for detected journey stops.
- If the presentation is missing, expired, rejected, or unavailable, the app
  instantly falls back to the stored Guardian journey.

## Required Google APIs

Enable Roads API, Routes API, and Places API (New). Put server-restricted keys
in `gateway/.env`:

```dotenv
JOURNEY_GOOGLE_PRESENTATION_ENABLED=true
GOOGLE_ROADS_API_KEY=
GOOGLE_ROUTES_API_KEY=
GOOGLE_PLACES_API_KEY=
```

Restart the gateway after changing environment variables. New presentations
are created after journeys close; the raw journey is written first.

## Firestore retention

Configure `expiresAt` as a TTL field for the `presentations` collection group.
Guardian writes a 28-day expiry to leave operational margin below the Google
Maps Platform 30-day cache ceiling. The app also refuses expired documents,
even if Firestore TTL deletion has not run yet.

## Enrich an existing journey

Preview the latest journey without writing:

```powershell
Set-Location gateway
npm run journey:enrich -- --imei <IMEI>
```

Write only its presentation subdocument:

```powershell
npm run journey:enrich -- --imei <IMEI> --apply
```

Add `--journey-id <id>` to target a specific journey. The command never
changes the parent journey document.

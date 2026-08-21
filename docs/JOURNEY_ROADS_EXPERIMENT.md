# Guardian journey road-alignment experiment

This experiment compares stored journey evidence with Google Roads API's
`snapToRoads` proposal. It does not update Firestore, replace the stored
polyline, recalculate distance, or change SOS evidence.

## Safety model

- Only point-evidence rows explicitly marked as valid satellite GPS are sent.
- WiFi and LBS fallback positions are excluded from road matching.
- Raw evidence remains the source of truth.
- Google output is treated as a display proposal and receives a conservative
  correction-distance and sample-density assessment.
- The generated HTML contains coordinates but never contains the API key.

## Setup

Enable **Roads API** in the Guardian Google Cloud project. For development,
create a server key restricted to Roads API and put it only in `gateway/.env`:

```dotenv
GOOGLE_ROADS_API_KEY=replace_with_server_key
```

Do not commit `.env`.

## Run against the latest journey

From `gateway`:

```powershell
node scripts/inspect-journey-road-alignment.js `
  --imei <WATCH_IMEI> `
  --output "$env:TEMP\guardian-road-alignment.html"

Start-Process "$env:TEMP\guardian-road-alignment.html"
```

To inspect a specific journey, add:

```powershell
--journey-id <JOURNEY_ID>
```

The report draws:

- gray dashed: all stored positions;
- orange: trusted GPS samples;
- blue: Google's road-aligned proposal.

`PASS for visual evaluation` does not make the blue route factual. It means
the proposal stayed within Guardian's experimental displacement and density
limits. `REJECT` means the product must retain an uncertain route presentation.

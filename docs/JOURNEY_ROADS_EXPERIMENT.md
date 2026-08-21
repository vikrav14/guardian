# Guardian journey road-alignment experiment

This experiment builds a local hybrid journey preview. Dense, trusted GPS
sections are compared with Google Roads API's `snapToRoads` proposal. Sparse
intervals are sent to Google Routes API for possible road geometry and are
shown only as explicit estimates. The experiment does not update Firestore,
replace the stored polyline, recalculate distance, or change SOS evidence.

## Safety model

- Only point-evidence rows explicitly marked as valid satellite GPS are sent.
- WiFi and LBS fallback positions are excluded from road matching. They may
  help rank a Google route alternative, but never become precise GPS evidence.
- Raw evidence remains the source of truth.
- Google Roads output is accepted only for locally dense GPS sections that
  pass Guardian's correction checks.
- Google Routes output for a sparse interval receives basic time, distance,
  endpoint, and approximate-observation checks. Accepted geometry remains
  labelled `Google-estimated route (not recorded)`.
- Estimated geometry is never used for SOS, safe-zone decisions, journey
  distance, or historical evidence.
- The generated HTML contains coordinates but never contains the API key.

## Setup

Enable **Roads API** and **Routes API** in the Guardian Google Cloud project.
For development, use server-restricted keys and put them only in
`gateway/.env`:

```dotenv
GOOGLE_ROADS_API_KEY=replace_with_server_key
GOOGLE_ROUTES_API_KEY=replace_with_server_key
```

`GOOGLE_ROUTES_API_KEY` is optional when one server key is restricted to both
APIs; in that case the script falls back to `GOOGLE_ROADS_API_KEY`. Keep the
separate variable when the API restrictions use different keys.

Do not commit `.env`.

The script runs only when invoked. It makes Roads requests for dense GPS
sections and one Routes request per sparse interval; it is not a background
job and does not add production polling or automatic API spend.

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

- faint gray dashed: the complete stored evidence trace;
- blue dots: trusted GPS samples in the optional evidence overlay;
- solid blue: GPS-supported Google Roads alignment;
- solid purple: Google route geometry for a sparse interval;
- amber dots: approximate WiFi/LBS observations in the optional evidence overlay;
- gray dashed interval: unresolved, with no route asserted as fact.

The console and report show how many sections were aligned, estimated, or left
unresolved. Even a visually convincing dashed-purple estimate is only a likely
road path between two reliable fixes. Validate the experiment against known
journeys before considering any product integration.

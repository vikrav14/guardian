# Guardian location provenance and retention

**Status:** Engineering and acceptance contract

**Applies to:** V52/ReachFar gateway, Firestore, Guardian app, WhatsApp facts

**Safety rule:** Connectivity, source, freshness and precision are separate facts.

## Why this exists

The watch can remain online indoors after satellite GPS becomes unavailable.
It may then report WiFi/cell information that Guardian turns into a broad
network estimate. That newer estimate must not erase the last valid satellite
fix, inherit its metadata, or make the app call an old position live.

The protocol evidence is deterministic:

- `gps=A` proves the packet contains a valid satellite fix.
- `gps=V` proves satellite GPS is not valid for that packet. WiFi/cell inputs
  may produce an approximate network position.
- V52 `gps=A` does not provide a dependable accuracy radius. Guardian stores
  `accuracyMeters: null`; it does not copy a previous WiFi/LBS radius.

## Firestore contract

Each persisted observation is self-contained:

- `location` and `lastLocationObservation`: latest persisted observation of
  any source.
- `lastSatelliteLocation`: most recent valid `gps=A` fix.
- `lastApproximateLocation`: most recent WiFi/LBS-derived estimate.
- Each map carries its own `source`, `gpsValid`, `accuracyMeters`, and
  `recordedAt` values.

The gateway retains source-specific locations independently. On the first
location write after this feature is deployed, it also protects a legacy
current GPS record before accepting a newer indoor fallback.

## Display selection

When an approximate indoor observation follows a satellite fix within 30
minutes, Guardian keeps the satellite pin on the main map and says **Last
satellite fix**. The newer approximate observation remains stored separately
and its estimated radius is disclosed in the Location check.

After 30 minutes, the newer approximate observation may become the map position.
It must be labelled **Approximate location** and, when the provider supplies a
radius, the map draws an uncertainty circle. The last satellite fix remains in
Firestore and is never relabelled as current.

The 30-minute window is a presentation policy, not data deletion. It avoids an
immediate indoor jump to a broad network estimate without allowing an old
satellite point to dominate indefinitely.

## Required user wording

Never collapse these statements:

- **Watch checked in 1m ago** — transport/presence fact.
- **Last satellite fix 12m ago** — satellite position and its own clock.
- **Approximate network location updated 2m ago (about 309m radius)** — newer,
  lower-precision observation.

Do not say **live GPS**, **current precise location**, or **within X metres**
unless the backend evidence supports that exact claim.

## Backend inspection

From `gateway`, inspect the retained evidence without starting watchers:

```powershell
node .\scripts\inspect-location-provenance.js --imei 861397052547492
```

The report separately prints the latest observation, last satellite fix, last
approximate observation, display selection, and any invariant violations. It
also states that `gps=A` proves satellite validity but does not by itself prove
metre-level accuracy.

## Real-device outdoor-to-indoor acceptance

1. Start the gateway and TCP ngrok tunnel, then point the watch at the current
   tunnel endpoint.
2. Walk outdoors with the watch until the gateway logs a location with
   `source=gps gps=A accuracy=not supplied`.
3. Run the inspection command and retain the JSON evidence.
4. Return indoors and request a location update. Wait for a gateway log with
   `source=wifi` or `source=lbs`, `gps=V`, and an estimated radius.
5. Run the inspection command again.
6. Confirm all of the following:
   - `latestObservation` is the newer WiFi/LBS estimate;
   - `lastSatelliteLocation` still contains the outdoor `gps=A` fix;
   - the satellite record has `accuracyMeters: null`;
   - the approximate record keeps its own estimated radius;
   - `displaySelection.retainedSatellite` is true inside the 30-minute window;
   - the app says **Last satellite fix**, not live/current GPS;
   - the watch check-in and location timestamps remain separate.
7. After the display-retention window, confirm an approximate position is
   explicitly labelled and shown with its uncertainty circle.

## Precision release gate

Satellite validity and satellite precision are different claims. To advertise a
numerical precision, collect repeated outdoor fixes at surveyed reference
points and report median, 95th-percentile and worst-case error. Until that test
passes, Guardian may say **satellite GPS fix**, but must not promise a specific
metre radius for V52 `gps=A` packets.

# Guardian Home Wi-Fi setup

Implementation checkpoint: 1 October 2026. Own-app enrollment is implemented;
live acceptance of this new flow is pending. Existing private Home detection
results remain valid within their recorded limits. This does not accept native
Wi-Fi fence provisioning, continuous Home detection, departure alerts or a new
reporting interval. The photo coordination investigation remains separate.

## User flow

Safe Zones → select the active zone named Home → Set up Home Wi-Fi. The service
owner with a linked watch and an active Family/Care plan can see recent networks
reported by that watch. Names are labels; same-name radios appear separately with
a short radio suffix. An unnamed radio is labelled explicitly. No network is
selected automatically. Confirm the selected network and saved Home map pin,
then press Save Home Wi-Fi. No Wi-Fi password is requested.

Saving stores a router fingerprint and clears previous Home evidence. It is not
proof the watch is currently at Home. The existing observer must qualify new
reports before Home appears in the map or ordinary WhatsApp location response.
Replace by selecting a new fresh report; Remove saved network clears enrollment
and current/remembered Home evidence but preserves the geographic safe zone.
Only the service owner can manage network data; a family member sees an explicit
owner-only message. Removal remains possible after subscription expiry.

The free-text Wi-Fi-name field was removed from Add safe zone because it did not
identify a router or enroll actual watch detection. Existing geographic zones
and their source-aware alert evaluation are unchanged.

## Runtime and security

- Server flag `WIFI_HOME_SETUP_ENABLED=true` enables the authenticated endpoint
  and enrollment runtime. No additional Flutter pilot flag. The app uses its
  existing `GUARDIAN_GATEWAY_URL`. Disabled/unavailable runtime is explained in
  the screen; requests do not fall back to unauthenticated endpoints.
- GET/POST/DELETE `/app/home-wifi?imei=...`; GET also takes `geofenceId`.
  Firebase tokens are verified with revocation checking. Owner linkage and Home
  ownership are checked server-side; Family/Care entitlement gates enrollment.
- Only reports received while an authorized setup screen is open enter the
  discovery cache. Up to 64 discovery contexts, at most five reported radios per
  scan. Choices expire after 120 seconds, using source and receipt times.
  Sessions expire ten minutes after the last authorized read and are swept at
  least every 30 seconds. Names/raw radio addresses stay in that bounded memory.
  The default packet parser and diagnostic path still omit names.
- The UI checks received reports every ten seconds while visible, for up to ten
  minutes; explicit Refresh opens another window. It does not trigger scans or
  CR. Opening the page just after a report may require waiting for the next
  normal report. With ten-minute reporting, this can take ten minutes or longer
  if a report lacks Wi-Fi data or connectivity is interrupted.
- Selection tokens are scoped to owner, watch, zone and pin. The server accepts
  no client-supplied SSID/MAC to enroll. Pin/owner/plan/scan freshness and the
  expected revision are rechecked inside the enrollment transaction. No blind
  automatic save retries; refresh resolves an uncertain result.
- `homeWifiEnrollments/{imei}` is backend-only, denied to all Firestore clients.
  It contains an HMAC fingerprint, private random key, chosen display label,
  owner, zone/pin binding, enabled flag, version and timestamp. It contains no
  raw MAC, Wi-Fi password, scan history or location history. Removing replaces
  it with a disabled revision tombstone and removes the key/hash/label.
- Enrollment changes and clearing device Home fields are atomic. Publishers
  recheck enrollment revision and current Home authorization transactionally
  before writing. A delayed old publisher cannot restore removed settings.
- A listener loads enrollments on restart. Observation remains synchronous and
  separate from alarm processing. Publishers activate on location/alarm packets
  and stop after 15 minutes without those packets. Enrollment-listener failure
  suspends enrollment observation/publication and retries after 30 seconds;
  published evidence can only last to its original expiry.
- Existing `.env` pilot enrollment is retained as fallback until an app
  enrollment/tombstone exists for that watch. The app setup runtime uses the
  established observer/display policy; the optional walk-recovery experiment
  is not enabled by this flag.

## What is deliberately unchanged

No `UPLOAD`, `CR`, `WIFIFENCE`, camera or other watch commands are sent by opening,
refreshing, saving or removing Home Wi-Fi. No reporting defaults, command priority,
SOS/fall timing, raw coordinates or alert thresholds are changed. Native Wi-Fi
fence behavior remains unverified. A missing router, expired report or router
outage never independently becomes a departure alert.

The existing observer requires three strong reports spanning at least 20 seconds,
no more than 60 seconds apart, and expires evidence after 120 seconds. These
rules do not support continuous Home detection from a ten-minute-only stream.
Do not lengthen freshness merely to keep Home green. A separate reporting-policy
change needs measured arrival/departure and router-loss tests.

## Acceptance

Before testing, restore the watch to the current Guardian tunnel and verify fresh
packets. The earlier AnyTracking recorder has a bounded lifetime; stopping it or
sending a routing SMS alone is not restoration evidence.

1. Run this branch's gateway with the existing private configuration directory,
   adding `WIFI_HOME_SETUP_ENABLED=true` to that process. Run this branch's app
   against that gateway. Do not copy or commit private `.env` files.
2. Open Home Wi-Fi at home and wait for a normal watch report. Verify the list is
   from the watch, includes observation times, and distinguishes same-name radios.
3. Select the known home radio, confirm the pin and save once. Verify the selected
   setting persists after reopening. Only later qualified sightings may show Home.
4. Restart the gateway. Verify saved enrollment returns without resetting source
   timestamps or manufacturing fresh Home. Verify app/WhatsApp provenance.
5. Remove once. Verify current and remembered Home clear, map pin remains and a
   delayed publisher/restart does not restore the old pilot enrollment.
6. Test wrong account/family member, expired scan, Home pin edit, subscription
   expiry, concurrent replacement and uncertain HTTP result. No unauthorized
   discovery or stale overwrite should succeed.
7. Separately test real departure/return and router loss; document observations
   without marking untested timing/battery guarantees as accepted.

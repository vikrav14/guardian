# Current location evidence for SOS and fall

New physical SOS and fall alerts use `fresh_incident_evidence_v2`. This replaces
the retained-GPS policy that could send an hours-old satellite position despite
a recent indoor network observation. Existing v1 alert snapshots remain immutable
and readable; this change does not edit or resend previous messages.

Selection at gateway receipt:

1. Use a qualified, unexpired v4 enrolled Home-radio match, captured synchronously
   from the enrollment runtime. Show **Home Wi-Fi detected**, near the saved Home
   pin, explicitly **not GPS**. An absent/revoked runtime binding cannot fall back
   to a cached database Home record. The existing two-minute radio expiry and
   repeated-match qualification remain unchanged.
2. Otherwise choose the newest valid GPS/Wi-Fi/cellular observation no more than
   ten minutes old. Keep its own place name, timestamp, source and estimated
   radius. A newer network estimate can replace older GPS; approximate does not
   mean an exact address or confirmed presence inside a house.
3. Without recent usable evidence, use the unavailable template with **no map
   link**. A heartbeat, battery report, remembered Home sighting or unknown source
   does not renew location evidence. Older coordinates remain in history.

Only coordinates in the actual incident packet may tolerate a watch clock up to
two minutes ahead of gateway receipt. That observation uses receipt time and
retains `deviceRecordedAt` plus `timeBasis: gateway_receipt_clock_skew`. A future
database observation is excluded, even by one millisecond. Missing device times
and resolver completion times never become fresh observation times.

Both alarm types freeze evidence before persistence. Notification retries and
later watch movement cannot replace the incident point. Body text, template
variant, map button and alert detail read the same snapshot. New v2 readers reject
stale primaries, altered Home anchors, bad timing and unsupported sources.

Ordinary WhatsApp location replies and the current app map also prefer recent
evidence. The app removes a pin after ten minutes without a new fix even when
Firestore is quiet; Home expires under its shorter lease. Past detections and
journeys remain historical records. No AI infers a current place from an old pin.

## Verification and remaining hardware acceptance

The regression includes a nine-hour-old GPS fix followed by a cellular estimate,
and the observed 1.404-second watch clock lead. Automated tests cover fresh and
expired Home, revoked bindings, unknown/missing/future timestamps, unavailable
map buttons, source/radius preservation, post-event immutability, and the real SOS
and fall dispatchers. Shared fixtures retain legacy v1 expectations separately
from current-map expectations.

A qualified fresh Home match and a physical fall still require supervised watch
acceptance after rollout. Online status alone cannot establish Home. Sparse or
absent watch radio reports must produce uncertainty rather than extend Home
presence indefinitely. Do not generate a synthetic live alarm to simulate that
acceptance or rewrite an old alert using later evidence.

## Pilot rollout — 8 October 2026

Code commit `24e9890` is deployed to the local pilot gateway for both alarm types
and to `guardian-fbadd.web.app`. Android build **29858149** was installed on the
existing Samsung with replacement-install semantics; application UID, original
install time and app-data directory identities were verified unchanged.

The release preserves the deployed journey place-name screen, incident readings,
photo features and intelligence client. Gateway configuration and both ngrok
addresses were verified unchanged; the watch reconnected after the restart.

All 1,793 main-based gateway tests passed. The deployed app integration passed
858 tests; final reader/dispatch tests and integrated static analysis passed.
The integrated gateway passed 1,890 tests with one unrelated journey-origin
assertion failure, reproduced on the unchanged live baseline. That failure is
not recorded as fixed by this location change.

Offline replay of the reported incident selected the newer cellular estimate
with a 502 m radius and retained its 1.404-second clock-lead audit evidence.
No replay notification was sent. Live Home/fall acceptance remains pending.

## Place-name correction — 9 October 2026

The 00:04 MUT physical SOS correctly selected its fresh cellular estimate, but
its WhatsApp message said "place name unavailable". The point was frozen before
ordinary device persistence added the successful reverse-geocoding result.
The previous offline replay reused an already labelled stored point and did not
exercise this incoming-packet ordering defect.

Both SOS and fall now resolve the selected point's name before saving the alert.
An existing name can be reused only at identical coordinates. Otherwise a lookup
has a 1.5-second limit with cancellation; a failure preserves the evidence and
skips the ordinary persistence retry for that point. A late result cannot change
the snapshot, and labels never renew timestamps or change source/uncertainty.
No new observation or previous town is substituted while waiting.

Main-based gateway validation: **1,802 passed**. Integrated live-release candidate:
**1,900 passed**, with the same unrelated journey-origin failure documented above.
Coverage includes both real dispatchers receiving an unlabelled incoming point,
failure and stalled lookup, cancellation reaching the provider, immutable late
responses, and persistence avoiding a second lookup. Offline replay of the
physical test now includes its place name while retaining coordinates, original
time evidence and the 267 m radius. No replay notification or alert edit occurred.

The physical test's owner alert arrived 14 seconds after gateway receipt. The
photo arrived 76 seconds after receipt (11 seconds after the camera command).
All four reading types were received after this SOS's requests; the approved
combined follow-up was delivered at 00:08:14 MUT, 3m54s after receipt. These are
watch estimates and receipt-time correlation, not clinical validation.

The incident packet contained no Wi-Fi scan. Subsequent reports saw the enrolled
router, mostly below the existing signal threshold; a qualifying repeated Home
match was not established. A nearby cellular estimate cannot prove presence in
the house. Home qualification was not weakened. Physical Home and fall acceptance
remain pending.

The place-name correction (`d2bf851`) was deployed to the pilot gateway at
00:17 MUT on 9 October, after fresh idle checks for photo and readings work.
Runtime configuration, ngrok endpoints and the existing release features were
preserved. This is a gateway-only correction; the web and Android release above
already render the snapshot's place name. The already-delivered alert remains
unchanged; a new physical alert with this correction still needs acceptance.

## Dashboard and Home follow-up — 9 October afternoon

The weather panel incorrectly preferred a historical Home sighting over a newer
Wi-Fi/cell observation. Gateway and client now select fresh qualified Home first,
then the newest valid location evidence. Historical Home remains history and
cannot override a newer network estimate. Weather can still describe a labelled
last-known area for up to 24 hours; the map keeps its ten-minute limit.

At the pilot owner's request, repeated sightings of the saved router now count
even with weak valid signal (-120 to 0 dBm). Router identity, three reports over
20 seconds, maximum one-minute gaps and two-minute expiry remain required. This
is evidence of proximity to the saved router, not proof of being inside a house.

Live diagnostics at 14:08–14:09 MUT also showed genuine watch reports arriving
2.7–2.8 seconds before their device timestamp. Journey ingress rejected them
before Home observation. Newly received location packets with a clock lead of
at most 15 seconds now use that packet's receipt time for live processing and
durable capture, retaining `deviceRecordedAt` and
`timeBasis: gateway_receipt_location_clock_skew`. Original decoded evidence and
alarm handling remain unchanged. Old, missing and larger future timestamps do
not gain receipt freshness; stored database records never pass this correction.

Validation: 1,810 gateway tests pass, including weak-router clock-lead replay,
GPS durability with both timestamps, stale/future rejection and duplicate-radio
replay. The composite runtime passes 15 focused location/incident/dispatch tests.
The composite app passes 860 tests and clean analysis. The dashboard update is
published on guardian-fbadd.web.app; Android 29859007 is installed on the Samsung
with application UID, first-install time and data-directory inodes preserved.

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

# SOS location selection and frozen incident evidence

## Defect addressed

At callback-SOS checkpoint `004b3ba`, the live Flutter avatar retained the last
satellite fix while SOS WhatsApp built its map from the newer raw device
location. A broad network estimate could therefore replace the primary pin in
the message. The worker also read the live location at notification time,
allowing an intervening observation to change the event's map.

## Implemented contract

`gateway/src/sos-location-snapshot.js` selects and copies evidence for each new
physical V52 SOS. The alarm dispatcher writes `alerts/{id}.sosLocationSnapshot`
in the same create as the incident. Selection occurs before telemetry writes,
reporting side effects and notification preparation. The raw alarm observation
is still persisted unchanged to tracking/history.

When the latest source is WiFi/LBS and a valid retained GPS fix exists, the SOS
primary map pin uses that GPS fix, matching `Device.mapDisplayLocation`. It is
always described as last known. The actual GPS observation time and place label
stay together; the network estimate cannot donate its age, label or accuracy to
GPS. Approximate-only incidents remain possible, explicitly described as
approximate with the supplied radius (not a claimed tower location).

This change deliberately does not invent a new GPS expiry threshold for the
live map. Very old GPS can remain its historical primary pin, but the message
states its age and that the current position is unconfirmed. A newer network
observation is retained separately with its own coordinates, source, time and
radius; its existence, age and radius are disclosed in the message.

The message body, selected template variant, fallback text, map button and
notification-log text use frozen incident evidence, never a new location read
while sending. Age is expressed relative to **SOS receipt**, so a delayed send
cannot make an old point appear fresh. The live dashboard may legitimately
move after the incident while the historical SOS map remains unchanged.

No snapshot means no location claim: a legacy or app-created SOS without a
backend-owned snapshot uses the no-location template. The app notification and
Meta notification are not intentionally suppressed for that reason. This patch
does not add a trusted capture workflow for app-originated SOS; that remains a
separate acceptance item. It does not rewrite or resend old incidents.

## Security and compatibility

The new field is top-level because the current client create allowlist already
rejects it, while arbitrary app payload data is not authoritative. Linked users
may resolve an alert but cannot change or delete its snapshot. Nested forged
snapshots in `payload` are ignored. No Firestore rule relaxation is included.

Standard and callback template names, language `en`, four body parameters and
map-button indices are unchanged. Callback templates still require the exact
private pilot IMEI/SIM match. Meta remains the only WhatsApp transport. No watch
command, mode, phonebook, secret, tunnel or live setting is changed by this fix.
No public incident identifiers, real contact numbers or home coordinates are
included in the new fixtures.

Fall-alert snapshots and the existing bounded `selectLocationForDisplay`
helper are intentionally unchanged; this SOS policy matches the live avatar,
which uses a different retention contract.

## Regression coverage

Run `npm test` from `gateway`, `npm test` from `firestore`, and `flutter test`
plus `flutter analyze` from `apps/mobile`.

- Shared JSON fixtures run against both the actual Flutter map model and the
  SOS selector (GPS followed by WiFi/LBS, old/unknown-age GPS, new GPS,
  approximate-only and unavailable evidence).
- Node tests cover invalid coordinates, source separation, future observations,
  Firestore timestamps, input mutation, snapshot absence/tampering, changed live
  device locations during delayed sends, and both Meta button layouts.
- The actual server event-dispatch function is executed with boundary mocks to
  verify snapshot creation, unchanged raw telemetry, lookup/geolocation failure
  handling and receipt-relative time. No live Firebase, API or watch is used.
- Rules emulator tests prove client creation/mutation of the snapshot is denied,
  normal app SOS creation/resolution remains allowed and unrelated reads fail.

## Physical acceptance still required

Keep PR #109 draft until the next controlled acceptance run. Automated tests do
not prove handset delivery or a successful cellular callback.

After pulling the verified commit and restarting only the gateway, preserve the
existing ngrok tunnels, watch alarm settings and Meta template approvals. Check
the intended primary contact and use one physical SOS press for the new test.

Capture the alert's snapshot, the WhatsApp message and its map destination. With
a recent retained GPS and newer approximate observation, confirm the map uses
the retained GPS and the text states its real receipt-relative age. Then obtain
a new watch observation and confirm it does not rewrite the previous incident
or its link. Verify a later, separate SOS can capture different evidence.

### Software completion checks

The integration suite executes the real event dispatcher with failing connection
bookkeeping, geolocation, adaptive reporting, device persistence, history and
intelligence dependencies. Each failure is logged and the physical SOS still
reaches alert creation with its frozen GPS evidence. These are recoverable
supporting-operation failures; this does not provide offline delivery when the
alert store or notification provider itself is unavailable.

The Essential contact-dispatch test also passes a later live GPS position into
the actual notification pipeline. The single primary recipient's Meta map button
and notification-log text both retain the incident coordinates and age. A missing
snapshot continues to select the no-location template.

### Next controlled pilot

The 24 August test rejected `MOD,0` as a platform-only/no-call solution on the
pilot firmware: the watch displayed **Calling...** and sent a carrier SMS. It was
restored to `MOD,1`. Do not send another mode command for this location test.

Before one new physical SOS, confirm all of the following privately:

- the tested PR head is running in the gateway and its TCP/Meta webhook tunnels
  are healthy;
- the Meta token is valid, each selected template is approved, and the intended
  emergency recipient is correct;
- callback templates are used only when the exact existing pilot IMEI/SIM guard
  matches; otherwise the standard SOS templates remain selected;
- the wearer and recipient understand the stock Calling-screen/carrier-SMS
  limitation and the purpose of this notification/location test.

Record app receipt, signed Meta `delivered`/`read` evidence, the exact map
destination, and a completed guardian-initiated callback with two-way audio.
Then verify later movement leaves the first snapshot unchanged. A later SOS,
after the 90-second window, must create a separate incident. API `accepted`
alone is not handset delivery. Keep PR #109 draft until these results exist.

Continue tracking the stock watch's prolonged Calling screen and inbound-call
availability separately. This software location fix does not resolve that
firmware behaviour or mark callback audio as accepted.

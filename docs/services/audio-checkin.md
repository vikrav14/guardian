# Consent-based audio safety check-in

| Field | Value |
|---|---|
| Service ID | `audio-checkin` |
| Minimum package | Family |
| Current state | Backbone only; disabled |
| Customer-visible | No; app entry point removed/hidden |
| Protocol surface | `MONITOR` |
| Vendor evidence | Conflicting; not live-proven |

This draft establishes matching gateway and Flutter contracts and closes the
previous generic customer command path. It does not activate a device command,
expose a menu item, or promise the service to customers.

## Manufacturer-document conflict

The two supplied V52 documents do not agree on the payload:

- the communication protocol sends bare `MONITOR` and says the tracker calls
  its configured master mobile number;
- the communication example sends `MONITOR,<phone>` and shows a phone number
  in the command.

Both exact builders are retained for a controlled, informed administrator
acceptance test. Neither variant is registered in the generic
`deviceCommands` dispatcher. A unit test proves framing, not callback behavior.

## Safety controls

- explicit household consent
- approved guardians only
- no recording or transcription
- one active request at a time
- rate limits and immutable audit

## Backend completion

- [x] fail closed while the feature flag is disabled
- [x] require an active Family/Care service and a linked guardian/admin
- [x] reject any callback destination supplied in the customer request
- [x] require a backend-owned verified callback, wearer consent and an accepted protocol variant
- [x] enforce one-active-request and rate-limit eligibility gates
- [ ] persist consent and verified-callback lifecycle records through a dedicated backend
- [ ] dispatch only the physically accepted MONITOR variant
- [ ] record requester, socket handoff, carrier outcome and termination outcome

## App completion

- [x] remove the old arbitrary-number “Listen in” control
- [x] keep the future customer entry point hidden while disabled
- [ ] show consent and privacy disclosure
- [ ] require positive confirmation
- [ ] show request and failure states
- [ ] provide revoke-access control

WhatsApp classifies a listen/monitor request but returns a deterministic safety
message. It does not call an LLM, stage an action or expose a MONITOR tool.

## Real-device acceptance

- [ ] resolve bare `MONITOR` versus `MONITOR,<verified callback>` on the real V52
- [ ] confirm callback, wearer indication, audio direction and carrier charging
- [ ] verify access denial for non-guardians
- [ ] verify audit and rate limits
- [ ] complete privacy and legal review before activation

Guardian cannot remotely end a carrier call merely by timing out the backend
request. “Time-limited” must therefore not be promised until a real termination
mechanism is proven. The feature flag and customer visibility must remain off
until every acceptance gate has evidence attached to the implementation PR.

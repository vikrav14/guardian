# Consent-based audio safety check-in

| Field | Value |
|---|---|
| Service ID | `audio-checkin` |
| Minimum package | Family |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `MONITOR` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- explicit household consent
- approved guardians only
- no recording or transcription
- one active request at a time
- rate limits and immutable audit

## Backend completion

- [ ] authorize each request
- [ ] validate callback destination
- [ ] dispatch time-limited monitor command
- [ ] record requester and outcome

## App completion

- [ ] show consent and privacy disclosure
- [ ] require positive confirmation
- [ ] show request and failure states
- [ ] provide revoke-access control

## Real-device acceptance

- [ ] confirm exact V52 MONITOR behaviour and carrier charging
- [ ] verify access denial for non-guardians
- [ ] verify audit and rate limits
- [ ] complete privacy and legal review before activation

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.

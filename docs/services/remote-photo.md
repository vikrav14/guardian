# Secure safety photo requests

| Field | Value |
|---|---|
| Service ID | `remote-photo` |
| Minimum package | Family |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `FTPIP`, `FTPPWD`, `PIC` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- explicit household consent
- approved guardians only
- private isolated media ingress
- short automatic expiry
- request rate limits and immutable audit

## Backend completion

- [ ] issue one-time photo request authorization
- [ ] isolate V52 FTP ingress from public storage
- [ ] validate and scan uploads
- [ ] store encrypted media with automatic expiry

## App completion

- [ ] require safety-purpose confirmation
- [ ] show request and upload progress
- [ ] display access and expiry notice
- [ ] support immediate photo deletion

## Real-device acceptance

- [ ] confirm FTPIP FTPPWD and PIC behaviour on exact V52 firmware
- [ ] complete privacy and security review
- [ ] verify upload isolation and expiry
- [ ] measure image size latency and SIM data use

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.

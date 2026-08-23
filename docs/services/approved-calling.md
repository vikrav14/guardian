# Approved family calling

| Field | Value |
|---|---|
| Service ID | `approved-calling` |
| Minimum package | Essential |
| Current state | Backbone and administrator provisioning only; disabled |
| Customer-visible | No |
| Supported direction | Approved guardian calls the watch |
| Live-proven protocol | `PHBX` |
| Documented but not product-accepted | `DEVREFUSEPHONESWITCH` |
| Excluded from Guardian's current SIM product | Outbound `CALL` and wearer-originated carrier calls |

The physical pilot proved clear two-way audio after an approved guardian calls
and the wearer answers. “Two-way audio” does not mean the wearer can originate
a call: Guardian's current Machine 500 MB SIM does not permit outbound calls.

This branch does not activate a customer menu or feature flag.

## Safety controls

- phonebook entries form an incoming-call allowlist
- provisioning is restricted to the strict administrator endpoint
- Firestore clients cannot enqueue `set_phonebook_contact`
- the generic device-command dispatcher rejects phonebook changes
- unknown callers were blocked on the pilot watch
- the current product never promises wearer-originated calling
- real contact values stay in the private operator session, not source control

## Current implementation

- [x] manufacturer-format `PHBX` builder
- [x] dedicated `POST /admin/device-phonebook/contact` endpoint
- [x] strict `ADMIN_API_KEY`/Firebase administrator authentication
- [x] JSON request body rather than contact data in a URL
- [x] contact name, number, command and frame omitted from API responses/audit
- [x] local `phonebook:provision` technician command
- [x] client Firestore command path denied with authorization tests
- [x] physical approved/unknown incoming-call and two-way-audio acceptance
- [x] phonebook persistence after reboot
- [ ] backend-owned approved-contact records and lifecycle
- [ ] authenticated customer contact-management UI
- [ ] safe-mode enforcement proven on a second production watch
- [ ] manufacturer-confirmed contact replacement/removal

## New-device provisioning

The watch must already have a live Guardian TCP session. Configure a strong
`ADMIN_API_KEY` in private `gateway/.env`, restart the gateway, then run from
`gateway` in a second PowerShell window:

```powershell
$imei = Read-Host "Watch 10-digit protocol ID or 15-digit IMEI"
$phone = Read-Host "Approved guardian number in E.164 form, for example +230..."

npm run phonebook:provision -- `
  --imei "$imei" `
  --slot 1 `
  --name "Primary guardian" `
  --phone "$phone"
```

Repeat with a different empty slot for another approved caregiver. Do not
reuse an occupied slot until replacement behavior has been accepted.

A successful response proves only that Guardian handed the PHBX frame to a
live watch socket. Every new device still requires this physical checklist:

1. Confirm the contact appears in the watch phonebook.
2. Reboot and confirm the contact persists.
3. Call from the approved number and confirm the watch rings.
4. Answer and confirm clear audio in both directions.
5. Call from an unknown number and confirm the watch does not ring.
6. Record the watch firmware, SIM package, slot and outcome without storing
   the contact number in GitHub.

If an unknown caller reaches a new watch, stop provisioning that device. Do
not guess a `DEVREFUSEPHONESWITCH` value: confirm the safe-mode state through
the watch/supplier workflow before handoff.

## Pilot evidence - 22 August 2026

- PHBX entry appeared on the physical V52.
- Entry remained after reboot.
- Approved phonebook number rang the watch.
- Unknown number did not ring the watch.
- Wearer answered; both sides could hear and speak clearly.
- Watch dial-pad and phonebook outbound attempts did not reach the guardian.
- The SIM was confirmed not to permit outbound calls.

No real wearer name, guardian number, SIM number or administrator key was
committed.

## Product wording

Use:

> Approved family members can call the watch, with clear two-way audio after
> the wearer answers. Unknown callers are blocked.

Do not use “wearer can call family”, “outgoing calls”, or an unqualified
“two-way calls” promise with Guardian's current SIM package.

## Remaining release gates

1. Repeat provisioning, approved calling and unknown rejection on a second
   production-equivalent V52 and SIM.
2. Prove or obtain the exact safe replacement/removal process from ReachFar.
3. Implement backend-owned contact persistence and authenticated customer UI.
4. Complete privacy, billing, Android and failure-state acceptance.

The manufacturer material supplied to Guardian does not document a PHBX
delete/clear form. Use only an approved number that may safely remain on the
watch until replacement/removal is confirmed.

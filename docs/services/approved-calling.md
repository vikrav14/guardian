# Approved family calling

| Field | Value |
|---|---|
| Service ID | `approved-calling` |
| Minimum package | Essential |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `CALL`, `PHBX`, `DEVREFUSEPHONESWITCH` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- approved-contact allowlist
- authenticated guardian changes
- arbitrary dialling disabled by default
- call attempt audit trail
- carrier voice-cost disclosure

## Backend completion

- [ ] persist approved contacts
- [ ] sync V52 phonebook and whitelist
- [ ] dispatch wearer call requests safely
- [ ] record command and call outcomes

## App completion

- [ ] manage approved family contacts
- [ ] show call-watch and allowed-call actions
- [ ] explain carrier voice usage
- [ ] show sync and failure states

## Real-device acceptance

- [ ] confirm exact V52 command forms on the target firmware
- [ ] verify wearer-to-approved-contact and guardian-to-watch calls
- [ ] verify unknown-number rejection behaviour
- [ ] test two supported SIM/carrier configurations

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.

## Controlled PHBX phonebook acceptance

The supplied manufacturer protocol defines one phonebook entry as:

```text
PHBX,<serial>,<UTF-16BE name hex>,<phone>,<picture bytes>
```

Guardian's first acceptance leaves the optional picture field empty. The
gateway computes the frame length and wraps the payload in the existing V52
`[SG*<protocol-id>*<hex-length>*...]` transport. `PHBX` is TCP-only: the watch
must be online with a live session, and no SMS fallback is allowed.

Before testing, configure a strong `ADMIN_API_KEY` in the private
`gateway/.env` and restart the gateway. The raw downlink route now rejects
dev-open access, including access through an HTTP ngrok tunnel.

In a second PowerShell window, from `gateway`:

```powershell
$imei = Read-Host "Watch 10-digit protocol ID or 15-digit IMEI"
$phone = Read-Host "Approved test number in E.164 form, for example +230..."

npm run phonebook:test -- `
  --imei "$imei" `
  --slot 1 `
  --name "Test" `
  --phone "$phone"
```

Expected script result: the command is handed to exactly one active watch
session. That proves transport only. Open Contacts/Phonebook on the physical
watch and confirm that slot 1 shows **Test** before attempting a short call.

The manufacturer material supplied to Guardian does not document a PHBX
delete/clear form. Use only an approved number that may safely remain in slot
1 until replacement/removal is confirmed with ReachFar. Do not experiment
with a stranger's number. A real contact appearance and short carrier call
must be recorded as acceptance evidence; a successful HTTP response alone is
not enough.

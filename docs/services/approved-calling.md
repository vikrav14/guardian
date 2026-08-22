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

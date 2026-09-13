# Protected V52 device administration

| Field | Value |
|---|---|
| Service ID | `admin-controls` |
| Minimum package | Operator |
| Current state | Backbone only; disabled |
| Customer-visible | No; operator-only |
| Protocol surface | `VERNO`, `RESET`, `POWEROFF`, `FACTORY`, `gprsgps`, `LZ`, `UPGRADE`, `APN`, `IP`, `PW`, `ANY`, `CENTER`, `SLAVE` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Safety controls

- operator role only
- step-up authentication
- typed confirmation for destructive commands
- immutable audit and reason code
- rate limits rollback and recovery runbook

## Backend completion

- [ ] separate diagnostics from destructive operations
- [ ] validate command-specific arguments
- [ ] queue commands with approval state
- [ ] record actor reason result and recovery status

## App completion

- [ ] hide from customer navigation
- [ ] provide operator capability and risk labels
- [ ] require confirmation and reason
- [ ] show command lifecycle and recovery guidance

## Real-device acceptance

- [ ] confirm each command against exact V52 firmware and vendor support
- [ ] prove customer accounts cannot discover or invoke controls
- [ ] exercise reset power-off and upgrade only on lab hardware
- [ ] complete rollback incident and recovery drills

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.

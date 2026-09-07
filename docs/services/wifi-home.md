# Wi-Fi home-presence detection

| Field | Value |
|---|---|
| Service ID | `wifi-home` |
| Minimum package | Family |
| Current state | Backbone only; disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | `WIFIFENCE` |

This draft establishes matching gateway and Flutter contracts. It does not activate a device command, expose a menu item, or promise the service to customers.

## Starting point after SOS acceptance — 7 September 2026

PR #109 merged into `main` as `0afd652`. This branch now carries its accepted
SOS/callback flow, frozen incident locations, ordinary WhatsApp location reply,
Alerts/Clear all screen and journey source validation. Home Wi-Fi is the next
work item; the service remains a disabled backbone.

The inspected V52 decoder already extracts nearby access-point identifiers and
signal strength into `wifiAccessPoints` for approximate geolocation. A log such
as `wifi=1` says only that one access point was reported. It does not establish
that the identifier belongs to the enrolled Home router, that the watch joined
that network, or that the wearer is indoors. The existing SSID geofence path
does not receive an SSID from the decoder.

`WIFIFENCE` currently appears in the decoder's server-command echo inventory;
that is not an implemented Home-presence event or proof of an accepted command
on this firmware. Do not invent a command or infer Home from provider Wi-Fi/LBS
coordinates. First validate whether the existing passive access-point reports
provide sufficient fresh evidence for matching an owner-enrolled router. If a
device command is required, retain the exact-firmware command acceptance gate.

## Required Home display and evidence separation

- When sufficiently fresh, validated observations match an explicitly enrolled
  Home network, the avatar may use the family's saved Home pin and say
  **Home · Home Wi-Fi detected**. This must not be labelled as a new GPS fix or
  a confirmed network connection.
- Keep the satellite fix, source and original timestamp separately. When useful,
  show its age alongside the Home evidence's own last-observed time.
- Unknown/public networks, SSID-name matches alone, revoked enrollment and
  stale observations must not move the avatar Home. Define and test an expiry
  policy before implementation is enabled; missing Wi-Fi alone is not proof
  that the wearer left Home.
- Fall back to the accepted location presentation when Home confidence expires
  or conflicts with stronger evidence. Do not overwrite stored GPS, add trip
  distance, invent departures/returns, or modify an existing SOS snapshot.
- Any use of Home evidence in a new SOS must have an explicit, separately tested
  location-selection contract. The accepted GPS/approximate SOS behavior is not
  changed by this disabled scaffold.

## Next implementation checkpoint

1. Verify the exact watch's passive report contains a stable identifier for the
   owner-confirmed Home router; keep identifiers and coordinates out of public
   evidence and never request a Wi-Fi password.
2. Add owner-scoped enrollment, identifier minimization, revocation and backend
   authorization. Linked caregivers may read accepted presence; a client must
   not forge backend-observed Home presence.
3. Implement and test a deterministic presence policy using source, freshness,
   repeated observations and conflicting evidence. A provider accuracy radius
   or heartbeat alone cannot establish Home presence.
4. Wire the Home map/avatar presentation with clear source/time labels and
   expiry, preserving the SOS and genuine-GPS journey regressions from `main`.
5. Attach real-device enter/leave, stale-GPS return, unknown-router,
   router-restart and genuine-outing results before enabling the feature.

## Safety controls

- store no Wi-Fi password
- hash or minimize network identifiers
- owner-controlled enrollment
- location fallback when confidence is low
- home-status access limited to linked caregivers

## Backend completion

- [ ] enroll supported 2.4 GHz identifiers
- [ ] normalize WIFIFENCE events
- [ ] combine Wi-Fi and location confidence
- [ ] persist bounded home-presence history

## App completion

- [ ] guide 2.4 GHz home enrollment
- [ ] show confidence and last update
- [ ] explain location fallback
- [ ] allow immediate network removal

## Real-device acceptance

- [ ] confirm WIFIFENCE syntax and event format on exact V52 firmware
- [ ] verify identifier privacy at rest
- [ ] test enter leave and router-restart cases
- [ ] test phones with split and combined Wi-Fi SSIDs

The feature flag must remain off until every acceptance gate has evidence attached to this pull request.

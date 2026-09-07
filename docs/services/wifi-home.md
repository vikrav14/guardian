# Wi-Fi home-presence detection

| Field | Value |
|---|---|
| Service ID | `wifi-home` |
| Minimum package | Family |
| Current state | Private router observer implemented; customer Home presence disabled |
| Customer-visible | Only after acceptance |
| Protocol surface | Passive V52 Wi-Fi observations; `WIFIFENCE` remains unverified |

This draft contains gateway and Flutter service contracts and a private,
read-only router observer. It does not activate a device command, expose a Home
menu item or change the customer map. No Home-presence product is enabled.

## Implemented private observation checkpoint

The gateway observes the original decoded packet before provider geolocation,
connection bookkeeping and write gating. It can therefore inspect a reported
router even when approximate geolocation fails. The observer is synchronous,
bounded to one explicitly configured pilot and at most 32 access points per
report, and has no network, Firestore, alert, journey or command dependencies.
An observer exception is isolated from both tracking and SOS delivery.

`WIFI_HOME_OBSERVE_ENABLED` defaults to `false`. Enabling it collects only
in-memory pilot evidence and redacted console diagnostics; customer Home
presence remains disabled. Every result includes `observeOnly: true`,
`customerActive: false` and `homeClaim: false`.

Matching requires an explicitly selected router identifier, stored as an
HMAC-SHA256 fingerprint with a random 32-byte private key and watch-specific
scope. The setup never saves the raw router identifier, requests a Wi-Fi
password, prints the key or changes any existing Meta, watch or admin settings.
This operator-controlled pilot setup is not the future customer enrollment or
linked-caregiver authorization flow.

The provisional observation policy requires three distinct, strong reports
(at least -75 dBm) spanning at least 20 seconds in both source time and gateway
receipt time. Reports must be less than two minutes old; gaps over one minute
restart the sequence. Evidence expires two minutes after the last qualifying
observation, using the earlier of source and receipt time. Heartbeats and
repeated/out-of-order timestamps cannot extend it. A fresh GPS report, unknown
router, absent/weak signal or contradictory source ends the current match;
missing Wi-Fi is not labelled as a departure. A gateway restart starts with no
match. These are conservative pilot thresholds, not proof of indoor presence.

The software verifies identifier syntax and matching, not radio band, network
association or physical ownership. The operator must choose the actual Home
router's 2.4 GHz radio BSSID, which may differ from its WAN/Ethernet MAC. Seeing
that radio can extend beyond the home; `matched` does not yet move the avatar.

### Run the private check

From `gateway`, after pulling this branch:

```powershell
npm run wifi-home:setup
```

Enter the Home router's 2.4 GHz Wi-Fi BSSID privately when prompted. Setup uses
the existing SOS pilot watch if configured, otherwise asks for the pilot IMEI.
On Windows, `netsh wlan show networks mode=bssid` can list nearby radios. Under
the owner's Home network, select the entry explicitly labelled `Band: 2.4 GHz`.
Paste only that entry's complete BSSID value (six hexadecimal pairs with colons
or hyphens), without its `BSSID 1` label or quotation marks. Input stays hidden;
press Enter after pasting. The software still cannot verify that this radio is
the owner's Home router or that it uses the chosen band.

Blank or malformed input now gives a field-specific explanation and another
private prompt. A valid locally administered unicast BSSID is accepted. Setup
does not write configuration until all inputs pass. Ctrl+C or ending input
before a valid answer exits without changing the environment. The earlier
generic "Valid pilot watch, router identifier and hash key are required" error
could be caused by router input alone; it did not mean the existing SOS pilot
or automatically generated key needed replacement.

It changes only its managed `WIFI_HOME_*` block in the ignored private `.env`,
preserving other configuration. It rejects conflicting shell overrides,
unmanaged duplicate settings, malformed blocks and an environment file changed
during setup. The temporary file is ignored and is removed on completion.

Restart the gateway normally. Leave the watch near the selected router for a
few report cycles and share only `[wifi-home]` diagnostic lines. They contain
the match state, source age, signal, counts and observation time, without IMEI,
router identifiers, fingerprints, keys or coordinates.

| Diagnostic | Interpretation |
| --- | --- |
| `candidate` | A qualifying report arrived; repeated fresh evidence is still needed |
| `matched` | The provisional repeated-router observation policy passed; no Home claim |
| `router_not_seen` | Reports did not contain the specifically configured router |
| `signal_weak` / `signal_unknown` | Router sighting does not meet the provisional signal requirement |
| `expired` | The qualifying evidence is older than two minutes |
| `satellite_observation` | A fresh GPS packet ended the Wi-Fi match |
| `configuration_incomplete` | Observation is requested but its pilot configuration is invalid |

Disabling/revoking this private observer requires removing its managed block
and restarting the gateway:

```powershell
npm run wifi-home:setup -- --disable
```

No raw history, incident snapshot or customer configuration is deleted. A
fresh-process script cannot inspect this runtime's in-memory observations;
use the running gateway's diagnostic lines.

### Software verification

Tests cover canonical passive V52 packet decoding into the observer, strong
and weak/unknown router observations, timestamp replay, stale/future readings,
backlog bursts, heartbeat expiry, source contradictions, fresh GPS, restarts,
watch-scoped fingerprints, redacted runtime logging and private setup/removal.
Setup CLI regressions cover hidden retries, blank/labelled pastes, Windows CRLF
input, locally administered BSSIDs, buffered answers and cancellation without
environment changes. These are software checks, not a real Windows terminal or
router acceptance result.
The actual SOS dispatcher is also tested with observer failure and failed
provider geolocation: alert creation and the frozen GPS snapshot are preserved.
No live observation, new Home UI, customer enrollment, Firestore write or
`WIFIFENCE` command is claimed by these tests.

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

## Remaining implementation and physical acceptance

1. Verify the exact watch's passive report contains a stable identifier for the
   owner-confirmed Home router; keep identifiers and coordinates out of public
   evidence and never request a Wi-Fi password.
2. Add customer owner-scoped enrollment, identifier minimization, revocation and backend
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

The customer feature must remain disabled until every applicable acceptance
gate has evidence attached to this pull request. The private observe-only flag
exists solely to collect the missing exact-device evidence; it cannot activate
Home display or send commands.

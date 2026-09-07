# Wi-Fi home-presence detection

| Field | Value |
|---|---|
| Service ID | `wifi-home` |
| Minimum package | Family |
| Current state | Private observer and separately opt-in Home display pilot; general customer activation disabled |
| Customer-visible | One explicitly configured pilot watch after local display opt-in; broader rollout still gated |
| Protocol surface | Passive V52 Wi-Fi observations; `WIFIFENCE` remains unverified |

This draft contains the private router observer and a separate, opt-in Home
display pilot requested after near-router recognition passed. The latter
connects bounded, backend-owned evidence to the existing app map, dashboard and
ordinary WhatsApp location reply. It sends no device command, adds no customer
enrollment menu and does not enable a general Home-presence product.

## Implemented private observation checkpoint

The gateway observes the original decoded packet before provider geolocation,
connection bookkeeping and write gating. It can therefore inspect a reported
router even when approximate geolocation fails. The observer is synchronous,
bounded to one explicitly configured pilot and at most 32 access points per
report, and has no network, Firestore, alert, journey or command dependencies.
An observer exception is isolated from both tracking and SOS delivery.

**Real-device checkpoint, 7 September 2026 UTC:** one configured V52 pilot
recognised the operator-selected 2.4 GHz Home radio. It advanced from
`candidate` to `matched`, then maintained seven consecutive qualifying readings
at -48 dBm, with displayed observation ages of 0–1 seconds. This passes the
near-router recognition checkpoint for that watch/radio pair. Signal-loss and
return, expiry and customer Home presence remain unaccepted. See the
[redacted acceptance record](../GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md#recorded-near-router-result--7-september-2026-utc).

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
a canonical cellular-only report with an empty access-point list carries no
new Wi-Fi evidence. It preserves an existing candidate/match without adding a
qualifying report or changing its source time/expiry. Gaps are measured between
qualifying router observations, so cellular packets cannot bridge a gap over
one minute. Missing Wi-Fi is not labelled as a departure. A gateway restart
starts with no match. These are pilot thresholds, not proof of indoor presence.

The `consecutiveMatches` diagnostic counts qualifying router observations with
no intervening conflicting Wi-Fi/GPS evidence. Cellular-only packets do not
count toward that number. Wi-Fi-labelled packets with missing/malformed scans,
inconsistent source fields, a different router or insufficient signal still
clear it. A run of cellular packets alone never establishes Home and cannot
retain an old match beyond the original two-minute radio expiry.

The software verifies identifier syntax and matching, not radio band, network
association or physical ownership. The operator must choose the actual Home
router's 2.4 GHz radio BSSID, which may differ from its WAN/Ethernet MAC. Seeing
that radio can extend beyond the home. `matched` alone does not move the avatar;
the separate display flag and verified saved Home binding are also required.

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
| `matched` | The provisional repeated-router observation policy passed; display requires its separate opt-in and saved Home binding |
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

### Enable the private Home display

The existing specification calls for **Home · Home Wi-Fi detected** at the
saved Home pin. The [ordinary location reply spec](whatsapp-location.md) records
the same source distinction and “at or near Home” wording. PR #122's dashboard
contract requires the hero and map to agree; PR #109's accepted SOS and journey
contracts preserve satellite evidence. This pilot implements that display
contract without changing those emergency or movement contracts.

After updating `feat/v52-wifi-home`, use the existing private enrollment:

```powershell
npm run wifi-home:setup -- --display-pilot
```

This sets `WIFI_HOME_DISPLAY_PILOT_ENABLED=true` only inside the managed private
block. It preserves the selected watch, fingerprint, key and all other gateway
settings. No second BSSID entry or Wi-Fi password is needed. Restart the gateway
and restart/rebuild the Flutter app so the new model and dashboard are loaded.
The ordinary WhatsApp reply needs no Meta template change.

The publisher requires exactly one active safe zone named `Home`, with a valid
saved pin, created by a linked service owner with an active Family/Care plan.
It does not select a provider network estimate, SSID or arbitrary first zone.
Missing/ambiguous Home zones, unverifiable ownership, inactive access and read
errors fail closed. The existing linked-watch rules protect reads and prevent
clients from forging or changing `devices/{imei}.homeWifiPresence`.

After three fresh qualifying reports, the map avatar uses the saved Home pin;
the hero, location tile and map show **Home Wi-Fi detected** with its own
detection age. Guardian's interpretation says **at or near your saved Home
location**, and shows the retained GPS age separately. The provider uncertainty
circle is hidden while this Home pin is selected so it cannot imply GPS-like
precision for the radio match. `location?` returns one link to the saved Home
pin, with the same Home source and separate GPS age.

The background publisher is independent of packet/SOS dispatch and updates
only `homeWifiPresence`. It never writes `updatedAt`, a watch heartbeat, raw
location, history, geofence transitions, intelligence, alerts or commands.
Valid renewals are limited to one write per 20 seconds; invalid evidence is
cleared immediately on the next publisher tick. The saved Home binding is
revalidated every 30 seconds and leased for at most 60 seconds, bounded further
by subscription expiry. Each display record expires at the earlier of that
lease or the observer's two-minute source/receipt lifetime. Heartbeats and
cellular packets never renew a radio observation. Successful Home/owner/plan
revalidation can extend the binding lease only up to the unchanged radio
expiry, preserving the original `observedAt`. This avoids a display gap between
valid radio reports. Failed reads, revocation and subscription expiry still
prevent extension. An expired record
is ignored by both app and chat even if the gateway or Firestore stops; the
dashboard checks expiry locally without needing another document event.

A fresh GPS report ends the match; a newer stored GPS fix also takes precedence
when the app/chat reads an older cached Home record. Weak/unknown router reports,
revocation, a changed Home pin/owner or subscription loss clear the display.
After a changed binding, fresh repeated router evidence is required again.
Falling back to GPS does not generate a departure or a trip. A failed write can
leave the previous display visible only until its already-issued expiry.

Redacted `[wifi-home-display]` diagnostics report `displayingHome: true` after a
successful usable publication, or a reason such as `home_zone_missing`,
`home_zone_ambiguous`, `home_owner_unverified`, `home_family_plan_required` or
`awaiting_router_evidence`. The `[wifi-home]` observer diagnostics still describe
the in-memory observer and retain `observeOnly: true` / `homeClaim: false`;
they are not the display publisher's activation status.

To revoke, run the existing `--disable` command and restart the gateway. No
new record is published, and a cached record expires within its bounded lease.
Normal router re-enrollment also resets display activation to `false`.
The saved Home safe zone itself is retained.

Staying near the router is sufficient for this private display check. A special
nighttime outing is not required. Real loss/return and router restart remain
separate acceptance items before any general customer rollout.

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
Shared `docs/testing/wifi-home-display.json` fixtures exercise app and WhatsApp
selection for fresh, expired, invalid, future and conflicting GPS evidence.
Publisher tests cover owner/plan binding, expiry, revocation, failed reads and
writes, and bounded renewal. A canonical V52 decoder/observer/publisher/chat
replay covers the reported long pause followed by alternating Wi-Fi/cellular
frames. It verifies Home selection, uninterrupted bounded display, truthful
source age and eventual fallback to retained GPS. Cellular-only sequences
cannot establish or refresh Home. Flutter tests cover Firestore parsing, consistent
labels and expiry without a document event. Emulator tests ensure linked users
can read Home evidence but cannot forge, replace or erase it. SOS fixtures
explicitly prove the presence field cannot alter a frozen incident selection.
These software checks do not claim a live Home display, customer enrollment or
an accepted `WIFIFENCE` command.

## Starting point after SOS acceptance — 7 September 2026

PR #109 merged into `main` as `0afd652`. This branch now carries its accepted
SOS/callback flow, frozen incident locations, ordinary WhatsApp location reply,
Alerts/Clear all screen and journey source validation. Home Wi-Fi is the next
work item; general customer activation remains disabled.

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
  changed by the private display pilot.

## Remaining implementation and physical acceptance

1. Near-router identity matching passed for one configured V52/radio pair on
   7 September 2026 UTC. Validate loss/return, router restart and expiry before
   accepting broader Home presence; keep identifiers and coordinates out of
   public evidence and never request a Wi-Fi password.
2. Add customer owner-scoped enrollment, identifier minimization, revocation and backend
   authorization. Linked caregivers may read accepted presence; a client must
   not forge backend-observed Home presence.
3. Validate the provisional deterministic policy on further physical cases.
   Software checks now enforce source, freshness, repeated observations and
   conflicting evidence. A provider radius or heartbeat cannot establish Home.
4. Accept the opt-in Home map/avatar and ordinary WhatsApp presentation on the
   configured watch. Clear source/time labels and expiry are implemented;
   real-device display acceptance is still pending.
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
- [x] show pilot Home source and last detection age
- [x] explain and implement expiring pilot location fallback
- [ ] allow immediate network removal

## Real-device acceptance

- [ ] confirm WIFIFENCE syntax and event format on exact V52 firmware
- [ ] verify identifier privacy at rest
- [ ] test enter leave and router-restart cases
- [ ] test phones with split and combined Wi-Fi SSIDs

The general customer feature must remain disabled until every applicable
acceptance gate has evidence attached to this pull request. The private
observe-only flag cannot activate Home display or send commands. The separate
display opt-in is limited to the configured pilot for the requested map/reply
check; it is not evidence that broader physical acceptance passed.

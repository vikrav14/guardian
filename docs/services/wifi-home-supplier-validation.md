# V52 native Wi-Fi fence validation

## Fresh router/GPS disagreement — 11 September 2026 UTC

The operator confirmed that the saved **Home pin is the actual house**, with a
50 m radius; School is a separate 150 m zone. A synthetic binding replay confirms
School/order cannot replace Home. The actual GPS-to-Home distance was not supplied.
The following times are from the operator's redacted running-publisher status:

| Event | UTC on 11 September | Interpretation |
| --- | --- | --- |
| Last qualifying radio observation | 20:56:20.000 | Source time, not GPS time |
| Latest usable Home renewal acknowledged | 20:56:44.931 | Backend publication |
| Home cleared with `gps_outside_home` | 20:56:47.979 | 3.048 seconds after renewal, before expiry |
| That publication's scheduled expiry | 20:57:26.672 | Clear was 38.693 seconds earlier |

The later `matchState: expired` is a separate subsequent radio-expiry result.
These facts establish why the display cleared, not an actual departure or measured
GPS error. The 50 m saved Home radius plus the minimum 30 m software margin would
classify a GPS position beyond 80 m as outside; the actual margin/distance was not
captured. Keep the saved boundaries unchanged.

The v3 correction publishes a bounded **conflict** state instead of erasing fresh
router evidence for a spatial GPS disagreement. App and ordinary WhatsApp show
**Location uncertain** and the fresh Home Wi-Fi observation, with the recorded
map position explicitly unconfirmed. No conflict can pass `home_ready` or select
the Home pin. Clear/resolution state changes bypass the renewal throttle; pending
or failed writes are never reported as successful publications. Missing/older
persisted GPS cannot promote a stored conflict. GPS invalidity and expired,
revoked, malformed or wrong-router evidence retain their existing fail-closed rules.

The shared app/chat contract includes legacy v1/v2 and v3 conflict/expiry cases.
Software checks are recorded on PR #116; hardware acceptance is still open.
This correction does not change actual GPS telemetry, SOS snapshots, geofence or
Journey decisions, the 50 m/150 m boundaries, report intervals or native fencing.
It does not establish continuous Home or eliminate all possible GPS false alerts.

### Next check for this correction

Pull `feat/v52-wifi-home` and restart the gateway and Flutter app from that branch.
Reuse the current enrollment. Run `npm run wifi-home:check` from `gateway`.
If fresh reports are needed, use `npm run wifi-home:check -- --request-location`
once. With `publishedConflictFresh: true` / `home_gps_conflict`, verify **Location
uncertain** on the app and ordinary `location?` reply, including Home radio age.
With `home_ready`, verify **Home Wi-Fi detected** at the saved Home pin. Let radio
evidence expire without more requests and verify the warning/Home claim clears
on both surfaces. Neither state transition is an arrival, departure or trip.
Save the read-only result and screenshot while the corresponding state is fresh.

No zone deletion, radius increase, Wi-Fi password, BSSID re-entry or repeat
`wifi-home:fence-trial -- --send` is needed. The earlier single-router native
setting still has no proven acknowledgement or rollback.

## Earlier Home/GPS integration fix — 11 September 2026 UTC

The operator authorized fixing the reproduced GPS-triggered Home clearing across
the existing app and WhatsApp paths. The v2 implementation keeps the enrolled
radio observation separate from coordinate source, checks the latest fresh GPS
against the saved Home area, and uses the same versioned selection contract in
the publisher, backend reader and Flutter. See [the service contract](wifi-home.md)
and [schema](../../firestore/SCHEMA.md#homewifipresence-map--private-display-pilot).

GPS at Home no longer clears a fresh radio match merely because it is GPS.
Outside, boundary-uncertain or invalid fresh GPS prevents Home selection. GPS
alone, heartbeats and missing/zero-radio scans cannot create or renew Home.
Declared different/weak/malformed radio evidence still clears it. The original
120-second radio lifetime, Home ownership/plan checks and pilot opt-in remain.
Raw location, journeys, geofence transitions and SOS incident selection retain
their existing sources and timestamps. No hardware command, upload/battery policy
change, native provisioning retry or longer Home lease is part of this fix.

**Software validation:** 810 gateway tests pass locally, including the real
decoder/runtime scan hook, radio/GPS coexistence, inside/outside positions,
expiry, late database writes, SOS isolation and existing journey regressions.
The shared app/chat fixtures cover legacy v1 and v2. Flutter and authorization
release gates must pass on the published commit before physical acceptance.
These results do not establish continuous Home, radio coverage or native fencing.

### Next physical check after the update

1. Stop the gateway, pull `feat/v52-wifi-home`, then restart it. Restart/rebuild
   the Flutter app **from that same branch**; a separate main/UI worktree may
   still run the old selector. Existing private enrollment can be reused.
2. Keep the watch near the enrolled router with its 2.4 GHz radio on. Keep the
   gateway's Ethernet or other Internet link stable. Run `npm run wifi-home:check`
   from `gateway`; check `selectionReason` as well as the radio `matchReason`.
3. If fresh reports are needed, start the existing redacted capture, mark
   `at_home`, and use `npm run wifi-home:check -- --request-location` once. This
   remains at most one protected CR burst, not continuous polling of the watch.
4. While `home_ready` is current, compare app hero/map/location tile and the
   ordinary `location?` reply. They must name Home Wi-Fi and use the saved Home
   pin, with radio detection age separate from GPS age. Record the time.
5. A GPS-valid report whose position agrees with Home must no longer cause a
   `satellite_observation` reset. Inspect its declared scan in the capture: an
   actual Home sighting may renew radio time; an empty/missing scan may not.
   A `gps_outside_home` or `gps_boundary_uncertain` selection reason means the
   position evidence still prevents the Home pin, even if the radio is matched.
6. Let the burst end without extra requests. If no new qualifying radio report
   arrives, Home must expire at its existing source/lease deadline on both
   surfaces, even with heartbeats. Save `wifi-home:fence -- --stop` / `--report`
   and the read-only checker output. This tests truthful expiry, not continuity.

Actual departure/return and a router restart remain separate daytime checks.
During radio-loss tests keep the gateway connected to the Internet; otherwise
the experiment mixes loss of the watch's radio evidence with a backend outage.
Do not run `wifi-home:fence-trial -- --send` again: a gateway restart resetting
`attempted` does not prove that the old watch setting was removed. No native
acknowledgement, reliable enter/exit semantics or rollback has been established.

## Early clearing explained: GPS priority — 11 September 2026 UTC

Historical diagnosis before the integration fix above:

The [redacted follow-up gateway log](../testing/wifi-home-gps-priority-2026-09-11.json)
resolves the previously unknown clearing reason. It preserves 72 selected entries
with original source line numbers and the attachment SHA-256, omitting identifiers,
coordinates and endpoints. Untimestamped lines retain their order, not invented times.

| Evidence | UTC | Mauritius |
|---|---|---|
| Observer clears with satellite_observation; GPS A follows | 11 Sep 19:51:48.868 | 11 Sep 23:51:48.868 |
| Successful clear from the earlier checker | 11 Sep 19:51:49.719 | 11 Sep 23:51:49.719 |
| Later normal radio expiry | 11 Sep 19:59:50.000 | 11 Sep 23:59:50.000 |
| A second satellite_observation clear | 11 Sep 20:02:11.259 | 12 Sep 00:02:11.259 |

The first observer clear precedes the recorded publisher clear by **0.851 seconds**.
Both GPS sequences have matching `displayingHome: false` / `satellite_observation`
diagnostics. Seven GPS summaries report `gps=A` with accuracy not supplied. Strong
Home observations at reported -30 dBm precede both switches. These logs do not
show the radio fields inside those GPS packets, nor establish the GPS error.

The second switch also logs **geofence_enter: Entered safe zone: Home**. The code
identifies this as server zone evaluation, not a native Wi-Fi-fence response. It
shows that the server Home-zone decision can coexist with withdrawal of the Home
Wi-Fi overlay. It does not prove a physical arrival or a previously false alert.

The then-current Home observer cleared its match as soon as a fresh GPS-valid report
arrives, before inspecting its radio scan or considering GPS accuracy/distance
from Home. The gateway display reader and Flutter's `homeWifiLocationAt` also
reject Home evidence for a newer/equal GPS fix. Thus changing only the observer
would leave the app and WhatsApp selection rules in disagreement with that change.

`lastHomePublication` records the latest usable successful write, including a
renewal. The log reports Home active before the 19:51:43.682 renewal, so the
previous six-second renewal-to-clear gap is **not a measured total Home duration**.
Home requalifies after the first GPS sequence, then normally expires at the
19:57:50 source time plus 120 seconds. The excerpt has three CR handoffs/replies,
with one packet_silence and two location_stale recovery reasons. This later expiry
is a reporting-gap issue, separate from the GPS-triggered clears.

**Integration direction at this checkpoint:** keep fresh enrolled-router presence as evidence
independent of coordinate source, then evaluate Home context and GPS together.
A new GPS observation alone does not establish departure; contradictory position
evidence or expired router evidence must be handled explicitly. Any future
selection change needs aligned gateway/Flutter/WhatsApp contracts and departure,
expiry, reconnect and SOS/Journey regressions. Neither unconditional Home priority
nor a longer lease is established by this log. This evidence-only checkpoint
preceded the authorized v2 implementation above.

### Next capture: radio fields in GPS-valid packets

This was the pre-fix capture plan. Use the updated physical check above now.

Keep the watch near the enrolled router, its 2.4 GHz radio on, and the gateway and
ngrok running. The existing version-1 scan diagnostics can inspect radio fields in
GPS-valid packets; this ordinary log cannot. No software pull/restart is needed.

```powershell
Set-Location "C:\Users\MSI\repos\guardian\gateway"
npm run wifi-home:fence -- --start
npm run wifi-home:fence -- --mark=at_home
npm run wifi-home:check -- --request-location
```

The checker attempts at most one protected CR; a current Home result may require
none. Record that outcome and any automatic recovery requests. Keep this capture
running through a new `satellite_observation` and its GPS packet, or for at most
eight minutes if none arrives, then collect:

```powershell
npm run wifi-home:fence -- --stop
npm run wifi-home:fence -- --report
```

Inspect fresh `gpsValid: true` rows for `radioScanStatus`, `homeRouterSeen`, signal
and fence bits. No GPS packet means same-packet coexistence remains untested; no
reported scan is not evidence that the router was absent. The planned radio-loss
comparison follows this check. Do not repeat native provisioning or change upload
intervals for it. Native acceptance, continuous Home and live UI agreement remain open.

## Home publication followed by an early clear — 11 September 2026 UTC

This was the initial assessment from the checker alone. The follow-up log above
now establishes `satellite_observation` as the clearing reason.

The subsequent [read-only publisher status](../testing/wifi-home-publication-cleared-2026-09-11.json)
confirms a successful backend Home publication in a later window than the capture
below. It does not establish publisher/UI state during that earlier capture.

| Publisher evidence | UTC | Mauritius (UTC+4) |
|---|---|---|
| Radio source observation | 19:51:22.000 | 23:51:22.000 |
| Successful Home publication | 19:51:43.682 | 23:51:43.682 |
| Successful clear | 19:51:49.719 | 23:51:49.719 |
| Published expiry | 19:52:26.421 | 23:52:26.421 |

Home was cleared **6.037 seconds after publication and 36.702 seconds before its
published expiry**. This is not the normal expiry of that published value.
The present state is unknown with no retained match timestamp; the current
publisher is idle, its Home binding ready and the session connected. These
current fields do not identify which event caused the earlier clearing.

The source audit at that checkpoint confirmed that a fresh GPS observation, a nonmatching/weak or
invalid scan, or a binding change/failure can withdraw Home evidence. Canonical
cellular-only reports preserve the existing evidence without extending it.
Normal observer expiry retains the prior source time and reports expired.
The CLI omits the observer reason, and publisher status does not retain a
historical clear reason. **Do not attribute this clear to GPS, radio loss or a
binding failure without the corresponding log evidence.** The shorter published
lease alone is expected when capped by the Home binding's validity.

Next preserve the running gateway's `[wifi-home]` and `[wifi-home-display]` lines
around 19:51:43–19:51:50 UTC, especially the first `displayingHome: false` reason
after `home_wifi_detected`. Resolve that withdrawal before another hardware
comparison; no restart, new CR or repeated native setting is needed to read the
existing logs. Backend publication is demonstrated; app/map/WhatsApp agreement,
continuous Home and native fencing remain unconfirmed. This checkpoint changes
documentation only.

## Fresh router baseline established — 11 September 2026 UTC

The [redacted strong-router capture](../testing/wifi-home-strong-router-baseline-2026-09-11.json)
began at 19:38:31.204 UTC and stopped after 467 whole seconds (7m47s). All 16
entries were retained. The operator first received `watch_not_connected`, then
verified a connected session/ready binding and received `locationRequestSent: true`.
The report identifies `scanDiagnosticsVersion: 1`, not the running process SHA.

| Evidence | Result |
|---|---|
| CR | One handoff, one reply 0.322 seconds later; first report after 3.553 seconds |
| Reports | Ten fresh, non-repeated UD_LTE reports, all non-GPS |
| Home radio | Nine enrolled-radio sightings, each at reported -30 dBm; one explicit zero-entry scan |
| Scan extraction | All ten decoded from packet fields: nine named sections, one empty section; no rejected radios |
| Timing | Reports span 170.741 seconds after the first arrival; maximum reported gap 24 seconds |
| Other activity | Two LK and one TKQ; only at_home marked; no UPLOAD/WIFIFENCE handoff or fence/SOS bits |

**This establishes a fresh enrolled-router baseline and validates the non-GPS
scan layout on this pilot.** It does not exercise the GPS-valid scan path on
hardware: every report has `gpsValid: false`. Improved reception cannot therefore
be attributed to the GPS diagnostic fix. The observation proves neither native
setting acceptance nor an entry/exit transition; the watch remained at the
operator-marked Home baseline. The process-local `attempted: false` flag still
does not establish removal of the earlier native setting.

A synthetic replay using the reported source/receipt times, signal and one empty
scan reaches the existing observer's match state at 19:42:17.393 UTC, after the
third router sighting. It counts nine qualifying observations. This is evidence
that the sequence fits the unchanged policy, not proof of actual publisher writes
or UI state. The checker final outcome/publisher status was not supplied.

The last router source time is 19:44:18 UTC (23:44:18 MUT); its existing 120-second
lease expires at 19:46:18 UTC. The elapsed-time stop bound is
19:46:18.204–19:46:19.204 UTC (upper bound exclusive), so the source evidence was
already expired when stopped. `secondsSinceLastRouterSighting: 114` measures
receipt age, which is younger than source age. This temporary CR burst still
does not establish continuous Home availability or justify changing expiry.

**Next:** read `npm run wifi-home:check` without requesting a new location and
inspect `lastHomePublication`, its source/expiry timestamps and the final checker
outcome. An expired current state can coexist with successful prior publication.
The subsequent result is recorded in the early-clear checkpoint above and takes
priority over the next hardware comparison.
After accounting for publication, the planned short marked radio-off/on comparison
can now use an established router baseline. It requires fresh evidence in that
new window; it does not require another native setting. This checkpoint preserves
evidence only and changes no runtime or hardware configuration.

## Scan diagnostics implemented — 11 September 2026 UTC

The private capture now reads the Wi-Fi section directly from the packet fields
for both GPS-valid `A` and non-GPS `V` reports. This resolves the diagnostic gap
identified below without adding radio fields to production location/alarm events.
The normal decoder, Home observer/publisher, geolocation adapter, SOS/Journey
selection, battery intervals and native-command sender are unchanged.

The extractor follows Appendix I's state/cell-count prefix, cell records, Wi-Fi
count and up to five name/MAC/RSSI entries. It also recognises the already-tested
nameless MAC/RSSI variant. It uses declared positions rather than searching SSIDs
for MAC-like text. Truncated, excessive or unrecognised layouts remain unknown;
they cannot create fresh router evidence. Null/multicast radio identifiers are
rejected, and missing scans stay distinct from a validated zero-entry report.
Raw fields are inspected only inside the existing bounded pilot capture; no
SSID, BSSID, fingerprint, coordinate or raw packet is added to its output.

New captures expose `scanDiagnosticsVersion: 1`. Each report adds:

| Field | Interpretation |
|---|---|
| `radioScanSource: packet_fields` | Original packet fields were inspected, including on GPS reports |
| `radioScanStatus: decoded` | The declared Wi-Fi section matched a supported layout |
| `radioScanStatus: not_reported` | No Wi-Fi count was available at the expected position; not a zero scan |
| Other `invalid_*` / `unsupported_*` status | Scan evidence unavailable; requires layout investigation |
| `radioScanLayout` | `named`, `nameless`, `empty`, or null |
| `declaredRadios` | Declared entry count when valid; independent of rejected radio identifiers |
| `rejectedRadios` | Null/multicast identifiers excluded from an otherwise decoded section |
| `radiosReported`, `homeRouterSeen`, `signalDbm` | Accepted radio count and redacted enrolled-router match/signal |

`decoded_event` / `event_only` identifies the legacy event-only capture input,
used when a caller supplies no original arguments. The running gateway passes
the original fields. All existing freshness, duplicate, backlog, expiry and
fixed alarm-bit rules still apply. A GPS packet can now have
`homeRouterSeen: true` in diagnostics while GPS remains selected in the app.
That observation does not enable the Home display or accept native fencing.

Validation: **780/780 gateway tests passed locally**, including five new tests
covering the live runtime hook, named/nameless layouts, absent/zero/invalid scans,
MAC-shaped SSIDs, privacy, GPS precedence, source-time/replay handling and SOS
events/ACKs. These are software results, not new physical-device acceptance.

### Next capture: stationary scan evidence

The first run of this procedure is completed above. Preserve that result and
read publisher status before starting a different physical comparison.

Keep the PC on Ethernet, both router bands enabled and the watch stationary near
the enrolled router. Keep ngrok running. Finish/save any active capture before
restarting the gateway. In its terminal, stop the gateway with Ctrl+C, then:

```powershell
Set-Location "C:\Users\MSI\repos\guardian"
git switch feat/v52-wifi-home
git pull --ff-only origin feat/v52-wifi-home
Set-Location gateway
npm start
```

In the Checks terminal:

```powershell
$Host.UI.RawUI.WindowTitle = "Guardian - Wi-Fi checks"
Set-Location "C:\Users\MSI\repos\guardian\gateway"
npm run wifi-home:fence -- --start
npm run wifi-home:fence -- --mark=at_home
npm run wifi-home:check -- --request-location
```

Confirm `scanDiagnosticsVersion: 1` in the started capture. The existing checker
attempts at most one protected CR and can poll for two minutes. It may return
`home_ready` without sending a request; record that distinction. About five
minutes after a confirmed request, stop and collect the capture:

```powershell
npm run wifi-home:fence -- --stop
npm run wifi-home:fence -- --report
```

Share the complete redacted report and request outcome. Keep the radio on for
this diagnostic capture; no off/on comparison or repeat WIFIFENCE is needed.
Automatic recovery CRs can still occur and must be accounted for in the timeline.
If the checker is blocked by connectivity or publisher I/O, collect the status
before attempting another request. A Home-publication failure can coexist with
useful GPS scan diagnostics. Look for supported scan rows and fresh enrolled
radio sightings before choosing the next physical experiment.

## CR baseline and protocol audit — 11 September 2026 UTC

The [redacted CR baseline](../testing/wifi-home-cr-baseline-2026-09-11.json)
records 18:55:50.704 UTC through a manual stop after 518 whole seconds. All 23
entries were retained. There were 14 fresh, non-repeated `UD_LTE` reports, four
heartbeats (three `LK`, one `TKQ`), two CR handoffs and two CR replies. No enrolled
router, fence event, `UPLOAD` or `WIFIFENCE` handoff was captured. Only `at_home`
was marked; no radio-off/on comparison took place in this window.

The CR replies arrived 0.402 and 0.373 seconds after their respective handoffs;
the first reports followed after 3.564 and 3.624 seconds. The first burst had
nine reports over 147.435 seconds; the second had five over 62.671 seconds before
capture ended. The second CR handoff was 180.535 seconds after the preceding
heartbeat, consistent with packet-silence recovery. Its caller is not recorded.
Do not describe this as two operator requests or a test free of automatic CR.

Five GPS-valid reports have `radiosReported: null`. Of nine non-GPS reports,
one exposed one access point that did not match the enrolled Home radio, and
eight exposed zero access points. Null is unavailable data, not a measured zero.
The preceding checker was blocked by a Home binding read pending 4,527 seconds;
it sent no CR. The operator restarted the gateway and verified an idle publisher
with a ready binding before this capture. The restart also reset process-local
trial history; `attempted: false` is not readback or removal of the watch setting.

The supporting gateway log contains a TCP disconnect/reconnect. The operator
reported a PC adapter change and later clarified that the PC uses Ethernet with
both router bands enabled. Exact change times were not supplied. This does not
establish the network configuration throughout the capture. Windows Wi-Fi
`disconnected` is compatible with a working Ethernet connection.

**Result:** the CR response/report path works, but no enrolled-router baseline
was established. Native fence acceptance and continuous Home remain unconfirmed.
Review scan observability before repeating the physical comparison.

### Supplier protocol and Mauritius

The supplier originals listed below were rechecked, including rendered pages.
The operator confirms that their shared V46/V48/V52 protocol applies to this V52.

| Supplier evidence | Meaning for this investigation |
|---|---|
| Protocol II.35, pages 9–10: router MAC slots, bare `WIFIFENCE` response, 2.4 GHz only | No country parameter or China-only restriction is stated. The one-slot form remains inferred and unacknowledged on the pilot. |
| Protocol Appendix I, page 14: up to five Wi-Fi entries, ordered by signal intensity; name, MAC and signal for each | The watch supplies radio observations. The gateway PC's Wi-Fi adapter is not the watch's scanner. |
| Protocol II.2, page 3: CR wakes GPS and requests a temporary reporting burst | This is not a documented Wi-Fi-only scan command or a promise of a scan in every report. |
| Protocol Appendix I: China MCC/MNC examples | Decode the watch's actual network fields; do not configure China example values on a Mauritius device. |
| V52 datasheet page 1: 802.11b/g/n, Wi-Fi accuracy 5–50 m based on Amap | Radio compatibility and location-database coverage are separate questions. Guardian uses Google for network geolocation, so that supplier accuracy range is not a local performance guarantee. |

Earlier real Home-radio matches in Mauritius show recognition is possible here;
they do not accept native fencing. The operator reconfirmed entering the same
2.4 GHz BSSID shown by their earlier Windows scan. Their later Intel adapter
properties screenshot shows the PC's own MAC, which is a different identifier.
No new identifier is added to this record. The earlier router scan advertised
802.11ax on 2.4 GHz; that does not establish ax-only mode. Check b/g/n compatibility
in its existing settings before proposing a radio-mode experiment.

### Decoder and provider findings

At `07cb350`, `parseLteExtras` extracts MAC/RSSI pairs from named Wi-Fi triplets
and accepts network MCC values beyond the China example. A synthetic local check
with two supplier-format name/MAC/RSSI triplets and MCC 617 decoded both APs and
their -61/-87 dBm signals in a `V` report. No hardware or provider request occurred.

However, `parseLocationData` calls that extraction only for `V` reports. The
same synthetic tail in a GPS-valid `A` report exposes no `wifiAccessPoints`, so
the capture records a null scan. The passive observer also deliberately gives
fresh GPS priority. Preserving scan metadata for diagnostics is a separate change
from changing Home/GPS selection. This is a demonstrated observability gap, not
proof that the five real GPS reports contained the enrolled radio. The parser's
MAC search is heuristic rather than a full validation of declared scan counts.

Google's [Geolocation request documentation](https://developers.google.com/maps/documentation/geolocation/requests-geolocation)
requires two or more physically distinct stationary APs for Wi-Fi positioning,
and excludes locally administered MAC addresses. The operator's enrolled BSSID
has that local-address bit. It can still be matched directly by Guardian. The
current provider adapter sends the scan and cell data and leaves IP fallback
enabled by default. Consequently, `source=wifi` describes our input classification,
not proof that Google used Wi-Fi. These facts may explain coarse coordinates;
they do not explain why an enrolled-router match was absent in this capture.

The diagnostic extraction is now implemented as described above. Provider
eligibility and IP fallback remain separate work. A new stationary capture will
establish whether the watch supplies the enrolled radio in supported GPS/non-GPS
scan sections, before choosing a further marked comparison. The existing native
setting and reporting policy remain in place; no command was sent by the audit.

## Stationary radio cycle completed — 11 September 2026 UTC

The [redacted radio-cycle evidence](../testing/wifi-home-radio-cycle-2026-09-11.json)
records a stopped capture starting at 18:18:01.469 UTC (22:18:01.469 MUT),
lasting 734 whole seconds, with all 14 entries retained and none dropped.
The `endsAt` value is the scheduled 30-minute ceiling, not the manual stop time.
No running-process revision was supplied.

| Operator-marked phase | Duration | Heartbeats | Location/radio reports | Fence events |
|---|---|---|---|---|
| Initial radio on | 2m22s from capture start; 2m09s after `at_home` | 3 | 0 | 0 |
| Radio off | 5m02.875s | 4 | 0 | 0 |
| Radio restored | Approximately 4m49s before stop | 4 | 0 | 0 |

There were ten `LK` packets about 73 seconds apart and one `TKQ`. No `CR`,
`UPLOAD` or `WIFIFENCE` handoff, command response or fresh enrolled-router
sighting occurred. The original morning trial remains recorded separately:
`queued`, `settingsApplied: null`, with no new native send in this window.

The `at_home` status briefly reported `sessionConnected: false`; subsequent
marker/final snapshots were connected. Heartbeats occurred in every phase,
including four while the radio was off, but the snapshots do not prove an
uninterrupted session. Physical switching and stationary placement are operator
observations, not verified by the gateway. No fresh router baseline was received.

**Result: no reported native fence transition during this marked cycle.** This
extends the earlier stationary reporting-gap evidence; it does not show whether
the watch scanned internally, applied the inferred setting, or supports it.
These packet-level counters precede geolocation and write gating, so discarded
database writes do not explain the missing decoded reports. This observation
does not justify a Home claim, a battery-band change or an extended radio expiry.

The subsequent CR baseline and its limits are recorded above. Supplier questions
continue in parallel. No repeat native provisioning is needed.

## Completed first native attempt — 11 September 2026

The operator has now attempted the one-router setting once on the connected
pilot. **Do not repeat the initial send runbook on this watch:** acceptance and
the stored setting remain unknown, and restarting the gateway does not undo it.

The [redacted completed capture](../testing/wifi-home-native-trial-2026-09-11.json)
covers 09:48:56.797–10:18:56.797 UTC (13:48:56.797–14:18:56.797 MUT). The
operator confirmed checkout `d59f4f9` before testing; the capture itself does not
report a running-process revision. All 39 entries were retained, with none
dropped, and the session was connected when the completed report was read.

| Evidence | Completed result |
|---|---|
| Native setting | One `WIFIFENCE` socket handoff; `queued` is not watch acceptance |
| Responses | Two, both `CR`; zero `WIFIFENCE` responses |
| Watch activity | 21 `LK` heartbeats and 13 fresh, non-repeated `UD_LTE` reports |
| Router evidence | One enrolled-router sighting at -57 dBm, observed at 10:10:18 UTC |
| Positioning | Eight GPS-valid reports and five non-GPS reports |
| Fence evidence | Zero captured entry/exit bits; no physical markers |
| Other commands | Two `CR` handoffs; zero `UPLOAD` handoffs in this window |

No report arrived for approximately 21m23s after the fence handoff. The first
`CR` at 10:10:15.826 UTC received a response and was followed by a report 3.609
seconds later. Ten reports then spanned 168.407 seconds. The second `CR` at
10:18:16.162 received a response and was followed by a report 3.664 seconds
later; three reports arrived before capture ended. The largest gap between
received reports was 312 seconds; that field excludes the initial wait for the
first report. Both CR handoffs occurred about three minutes after the preceding
heartbeat, consistent with packet-silence recovery, but this capture does not
record their caller. Do not attribute them to the trial CLI.

This demonstrates a functioning command-response/report path for `CR`, and
continued ability to see the enrolled radio. It does not demonstrate native
fence acceptance or continuous Home presence. The aggregate response count must
not be presented as a fence acknowledgement. One router report cannot satisfy
the existing three-report Home match. A local synthetic decode/capture check
also recognises the documented bare `WIFIFENCE` response; that software result
cannot exclude an undocumented response or establish physical receipt.

**Assessment: inconclusive native-setting result, not a hardware pass or proof
that the feature is unsupported.** No departure/return was marked, and no
stored-setting readback or removal was verified. The two CR bursts mean this
was not an observation window free of other commands. Preserve the existing
expiry, SOS/GPS/Journey contracts and reporting policy. Do not select a new
battery interval or recurring Home poll on this evidence.

Supplier clarification can proceed alongside further controlled tests; it is
not a prerequisite for the observation sequence below. The supplier check should
include the exact firmware, the 29-byte/`001D`
one-entry hypothesis, zero fence replies alongside two successful CR replies,
and these questions: is the one-entry form supported; is its response expected;
how can its current setting be read and removed; and how are Wi-Fi fence
transitions/current state recovered independently of location upload cadence?
These questions are prepared, not sent. A later supervised departure/return
capture can observe behaviour without re-provisioning, but must keep physical
markers and treat generic fence bits as source-unconfirmed until correlated.

## Continue controlled experiments — operator direction, 11 September 2026

The operator reaffirmed that the work should explore different hypotheses.
An inconclusive first capture does not end that work. The next sequence changes
observable conditions while retaining the setting already attempted. The first
radio cycle and the later CR baseline are now recorded above. The baseline did
not establish enrolled-router evidence, so the short CR/radio cycle remains open.

| Experiment | Variable to change | Evidence sought |
|---|---|---|
| Completed: stationary radio loss/restoration | Enrolled 2.4 GHz radio on, off, then on; watch stays still | 11 heartbeats, zero reports/fence events or command handoffs; native setting remains unconfirmed |
| Completed: CR baseline; short radio cycle deferred | CR/report path observed, but no fresh enrolled-router baseline | Two CR handoffs/replies, 14 fresh reports, no router/fence evidence; audit scan visibility before repeating |
| Physical departure/return | Watch leaves radio range and returns while the router stays on | Independently marked physical movement and any corresponding fence evidence; generic GPS/geofence bits alone do not establish a Wi-Fi source |
| Further command interpretation if still unresolved | One explicitly specified alternate payload, with its source and expected response recorded before use | A distinguishable response or behaviour; no automatic retry/fallback chain |

The current single-router sender implements only the form already attempted;
it does not implement an alternate-payload trial. A new command hypothesis needs
its own bounded implementation and review of the existing uncertain setting.
The completed send must not be repeated simply by restarting its attempt guard.
Keep the battery policy unchanged for the next radio test so it is not a second
deliberate variable. A later reporting-policy comparison remains a separate
experiment and must preserve SOS and outing overrides.

### Next test: radio on, off, on with the watch stationary

This first-pass runbook is retained for reproducibility. Its completed result is
recorded above; proceed to the CR comparison rather than repeating it unchanged.

Use the existing running gateway and ngrok. The computer must retain internet
access through 5 GHz or Ethernet when the 2.4 GHz radio is disabled; verify that
before starting. Do not power off the whole router. Keep the watch in the same
place near the enrolled router throughout. The first completed report is already
preserved in this repository; starting a new capture replaces the in-memory
capture, not the watch setting. No pull or restart is needed for these commands.

1. In the Checks PowerShell terminal, start a new capture and mark the baseline:

   ```powershell
   Set-Location "C:\Users\MSI\repos\guardian\gateway"
   npm run wifi-home:fence -- --start
   npm run wifi-home:fence -- --mark=at_home
   ```

   Leave the 2.4 GHz radio on for two minutes. Do not deliberately request CR,
   change upload intervals or send another native setting in this first pass.

2. Disable only the enrolled router's 2.4 GHz radio, then immediately mark it:

   ```powershell
   npm run wifi-home:fence -- --mark=router_off
   ```

   Leave it off for five minutes. Confirm the gateway still receives watch
   traffic; interrupted gateway transport limits what the capture can establish.

3. Re-enable the same 2.4 GHz radio, then mark restoration:

   ```powershell
   npm run wifi-home:fence -- --mark=router_on
   ```

   Leave it on for five minutes. Re-enabling must preserve the enrolled radio
   identity; creating or renaming a different access point changes the test.

4. Stop and collect the redacted report:

   ```powershell
   npm run wifi-home:fence -- --stop
   npm run wifi-home:fence -- --report
   ```

These durations define observation windows, not supplier-guaranteed detection
deadlines. Existing automatic CR/UPLOAD activity may occur; use the captured
handoffs when interpreting the result. Compare source timestamps, radio
sightings, response packet names and fence bits around the operator markers.
Router loss is not physical departure, and fence bits remain source-unconfirmed.
A quiet result leads to the next controlled comparison; it is not proof of
unsupported firmware or a reason to promote a Home claim.

### Next test: one CR with a short radio cycle

The first baseline attempt is recorded above. Review the decoder's GPS-report
scan limitation and verify the enrolled radio before repeating this runbook.

Keep the enrolled 2.4 GHz radio on, the watch stationary near it, and gateway
internet on 5 GHz or Ethernet. Keep the gateway and ngrok running. This test
uses one existing protected `CR` request, not another `WIFIFENCE` setting or an
`UPLOAD` change. No software pull or restart is needed.

The supplier describes a roughly three-minute CR reporting burst. A five-minute
radio-off period would run beyond it, so this comparison deliberately uses a
shorter off interval. It tests reporting during that burst, not an equal-duration
repeat or a guaranteed native-fence detection deadline.

1. In the Checks terminal, start a fresh capture and mark placement:

   ```powershell
   Set-Location "C:\Users\MSI\repos\guardian\gateway"
   npm run wifi-home:fence -- --start
   npm run wifi-home:fence -- --mark=at_home
   ```

2. Open a second Checks PowerShell tab for the request:

   ```powershell
   $Host.UI.RawUI.WindowTitle = "Guardian - Wi-Fi request"
   Set-Location "C:\Users\MSI\repos\guardian\gateway"
   npm run wifi-home:check -- --request-location
   ```

   Leave this command running; it can poll for two minutes. Once it prints
   `locationRequestSent: true`, begin a 60-second baseline window. Watch the
   gateway for a new `[wifi-home]` candidate/matched reading with a current
   `observedAt` and observation age of a few seconds. A current capture report
   with `timeStatus: fresh` and `homeRouterSeen: true` is stronger packet evidence.
   Generic `[location] source=wifi` is not proof of the enrolled router.

   If the checker reports `home_ready` without `locationRequestSent: true`, it
   did not deliberately send a CR. If there is no fresh enrolled-router baseline
   within 60 seconds, keep the radio on and collect the capture after five
   minutes. In either case, inspect the timeline before another request; do not
   blindly retry a failed or uncertain handoff or label this an awake comparison.

3. As soon as fresh enrolled-router evidence arrives within that first minute,
   disable only the 2.4 GHz radio and mark it in the original Checks terminal:

   ```powershell
   npm run wifi-home:fence -- --mark=router_off
   ```

   Restore the same radio after **60 seconds**, then mark it:

   ```powershell
   npm run wifi-home:fence -- --mark=router_on
   ```

   This targets restoration within two minutes of the CR handoff. Do not wait
   for the request checker to finish before switching the radio. Keep it on for
   five minutes after restoration to capture the burst and any later behaviour.

4. Stop and collect the report in the original Checks terminal:

   ```powershell
   npm run wifi-home:fence -- --stop
   npm run wifi-home:fence -- --report
   ```

Share the complete redacted report and checker output. Verify the actual CR
handoff, response and fresh report timestamps against both radio markers;
additional automatic CR/UPLOAD handoffs are possible and must be accounted for.
Router sightings disappearing/returning validate observation changes only.
Generic fence bits require correlation and remain source-unconfirmed. Zero
events during this short interval cannot prove the inferred setting unsupported.
The battery percentage, internal scan state and applied upload setting are not
measured by this capture; record that limit rather than infer them from heartbeats.

## Decision — 8 September 2026

Use the supplier's documented V52 operating model as the baseline. The operator
confirmed that the supplied V46/V48/V52 protocol and examples apply to this V52.
Shared model names are not a reason to reject that documentation. Preserve the
accepted V52 Appendix I alarm layout when another appendix conflicts with it.

Validate native fence behaviour before replacing normal battery reporting bands
or introducing recurring Home `CR` requests. The current battery policy,
SOS/outing overrides, radio expiry, GPS selection, journeys and notifications
are unchanged by this validation tool.

The operator subsequently requested testing a reasonable interpretation of
section II.35 before receiving supplier clarification. A separate private
**single-router experiment** is now implemented. This supersedes the earlier
supplier-first pause for that experiment only; the inferred form is not added to
the production command dispatcher or represented as supplier-confirmed syntax.
See [the exact trial and its limits](#operator-requested-single-router-experiment).

## Sources inspected

These are operator-supplied originals, retained outside the repository. No live
identifiers, screenshots or supplier PDFs are added to Git history here.

| Document | Relevant evidence | SHA-256 |
|---|---|---|
| `v52(1).pdf` / `v52.pdf`, page 2 | Two 2.4 GHz Wi-Fi zones; departure alert; recommended normal 10-minute location uploads, temporarily one minute when urgently locating, then 10 minutes or one hour | `0d2d4130ca97f7cf526de7412fb2591140ddf3c5c14d9db2153ca6a2b2e02590` |
| `V52-DataSheet(2).pdf`, pages 1 and 3 | 802.11b/g/n; Wi-Fi accuracy based on Amap; Wi-Fi fence entry/exit in supplier Android app | `503c0f4f8efebbb78893f28c654f29fcf7d7e3b6dbcc374b9ba54d8285a374fd` |
| `2. V46-V48-V52 Communication Protocol(1).pdf`, II.1/II.2 page 3, II.35 pages 9-10, Appendix I pages 13-14 | `UPLOAD` seconds; `CR` wakes GPS and reports every 30 seconds for about three minutes; `WIFIFENCE` router slots and bare response; fence bits 18/19 and Wi-Fi observations | `8f01881b9773f9ee762ceb2cc4dff9aa037abfa7a5540d6a723e1f4dd9161dbf` |
| `3. V46-V48-V52 Communication Example(1).pdf` | Reviewed companion examples; no additional native fence capture/removal recipe | `976b5721fbde52959a62d9f8975b9faf4bf6263e4b057d1eaa72950820e73e2b` |
| `1. Switch-Server SMS-Commands.pdf`, page 1 | Server, APN, status and contact provisioning; vendor server examples use port 7720, unlike the older repository copy's 8888; no fence or reporting policy | `dd3132d753aa89d9e67a9cd84dfcff525a42c35c5e265cbdff74c8f1f4d9281d` |

The first four attachments are byte-identical to the copies inspected in the
preceding supplier review. The SMS attachment is a different revision. Supplier
server values are examples, not Guardian/ngrok configuration changes.

## What follows from the documents

Wi-Fi positioning estimates coordinates from nearby networks. Native Wi-Fi
fencing recognises configured radio identifiers and reports zone transitions.
Guardian's existing passive pilot instead matches incoming router observations
at the gateway and publishes an expiring saved Home anchor. The separate native
setting was attempted on 11 September; whether the watch applied it is unknown.

The documented temporary `CR` burst is consistent with the observed few minutes
of reporting followed by silence. This is an inference, not accepted timing on
the pilot firmware. The code's historical `sendContinuousReporting` name does
not establish indefinite reporting. Repeated `CR` could repeatedly wake GPS;
its battery impact must be measured before any automatic loop is selected.

Guardian's 1/5/10/15-minute normal battery bands and two-minute radio expiry are
our policies. The guide does not prescribe those bands. A five-minute reporting
target can outlast the two-minute Home evidence, but that mismatch alone does
not explain why a firmware reporting burst ends. The intended later policy is
a supplier-aligned normal baseline, faster reporting for active need, and a
critical-battery safeguard. Existing manual reporting bypasses the automatic
SOS interval override; do not use manual mode as a shortcut for that redesign.

## Exact command boundary

II.35 gives the complete payload:

```text
WIFIFENCE,1,<radio-1>,2,<radio-2>,3,<radio-3>
```

With three 17-character MAC addresses the payload is 69 ASCII bytes (`0045`).
It documents a bare `WIFIFENCE` response and supports 2.4 GHz radios. A socket
handoff or response alone does not prove the setting applied or that Home was
detected. Generic fence bits 18/19 do not identify a Wi-Fi zone by themselves.

The guide describes two zones while this command example contains three slots.
No supplied document defines one-router provisioning, unused slots, replacement,
readback or removal. The preview builder therefore supports only the complete
three-distinct-radio form and is not connected to any transport. It rejects
empty, shorter, duplicate-padded and malformed lists. No zero MAC, repeated
router, guessed `WIFIFENCE,0`, or guessed SMS fallback is offered.

The earlier plan waited for single-router and removal instructions before any
native setting. The operator has now explicitly asked to anticipate the indexed
entry meaning and test it. That authorises the private hypothesis below, while
`CLAUDE.md`'s restriction on invented production commands remains intact. No
repository instruction is changed. General provisioning/removal still requires
documented or accepted behaviour. The three-entry example is not proof that
three routers are mandatory.

## Operator-requested single-router experiment

**Hypothesis:** `WIFIFENCE,1,<enrolled-radio>` sets the first fence slot with a
one-entry list. Section II.35 motivates this interpretation but does not confirm
it. With a 17-character MAC, the payload is 29 bytes (`001D`). The dedicated
experimental builder contains exactly that form: no duplicate/zero padding,
arbitrary slots, raw command field, deletion guess or SMS fallback.

`npm run wifi-home:fence-trial` (or `--preview`) is offline and sends nothing.
Only explicit `--send` starts a fresh capture and attempts the native setting.
The CLI reads the router privately because existing enrollment stores its hash,
not the MAC required on the wire. It checks enrollment locally; the authenticated
gateway independently checks the same watch-scoped fingerprint. Router input is
in a bounded POST body, never a URL, routine log, response or persistent record.

The dedicated `POST /ops/wifi-fence-single-router-trial` route requires strict
administrator authentication, the configured pilot, explicit experimental mode,
a matching active capture with at least a minute left, and exactly one writable
socket with the pilot's actual IMEI/protocol ID binding. It refuses unknown fields
and extra commands. Immediately before writing, a synchronous process-local
guard records the attempt. Concurrent/repeated requests, write exceptions and
diagnostic failures cannot cause a second trial send in that gateway process;
starting a new capture does not reset the guard. CLI HTTP timeouts are eight
seconds, redirects are rejected and uncertain POSTs are never retried.

**Material limitations:** the setting may persist after reboot or replace other
fence configuration. There is no proven readback, removal or rollback command.
Stopping capture, restarting Guardian or disabling the Home display does not
remove it. The one-attempt guard is in gateway memory; restart is not an undo
operation and must not be used to retry an uncertain send. Native fence AL
packets continue through existing alarm handling and may generate existing
alerts/notifications. A software-only experiment cannot guarantee firmware
behaviour; run on the operator's supervised pilot watch.

The experiment itself sends no `CR` or `UPLOAD`. Existing reporting/SOS/outing
policy can still run normally; the capture records their handoffs separately.
The gateway's `queued` result only means a socket write was queued. A subsequent
`command_response` with `packet: WIFIFENCE` means a response was observed, not
that a router was stored or that a fence works. `settingsApplied` stays null,
and `homeClaim`/`nativeFenceAccepted` remain false. Current normal APIs/UI gain no
fence setup button. Live status labels the available route
`provisioningMode: experimental_single_router_only`; it becomes unavailable for
another send after an attempt. The older documented preview remains read-only.

### Run the experiment on Windows

For a pilot that has never had a send attempt. The current operator's watch
already had its first attempt on 11 September; use the completed result above
and do not re-run this provisioning sequence to chase an acknowledgement.

Stop the gateway, keep ngrok running, then from `gateway`:

```powershell
git pull --ff-only origin feat/v52-wifi-home
npm start
```

In a second terminal:

```powershell
Set-Location "C:\Users\MSI\repos\guardian\gateway"
npm run wifi-home:fence-trial -- --preview
npm run wifi-home:fence-trial -- --send
```

Enter the enrolled 2.4 GHz BSSID at the hidden prompt. A fresh 30-minute capture
starts automatically; an existing recording must finish or be stopped first.
There is no need to re-enroll the router, change battery policy or trigger SOS.
After a short pause inspect the response, then again after 10-15 minutes with
the watch still near the router:

```powershell
npm run wifi-home:fence -- --report
```

Share only that redacted report. A `queued` result followed by silence is
inconclusive; do not send a different variant or repeat the setting. Router
recognition/reports can be observed while indoors, but a stationary test without
a transition cannot by itself prove a departure alarm works. Later controlled
departure/return and router-loss tests need independent physical markers and a
working gateway connection throughout. Router loss is not wearer departure.

This trial first checks command response and real behaviour. It does not repair
the app's continuous Home display or promote generic fence bits into confirmed
Wi-Fi Home state. Supplier clarification remains useful even after a response.

## Implemented observation tool

`npm run wifi-home:fence` reads the running gateway. `--start` opens one
30-minute in-memory capture for the existing private pilot. No additional
environment flag, BSSID entry, password, Firestore read/write, report request
or watch setting is needed. The endpoint requires strict administrator auth,
including in local development, and checks the configured pilot.

The capture records:

- Received report gaps separately from LK/TKQ heartbeats.
- Source timestamps and fresh/stale/future/buffered/repeated classifications.
- Whether the enrolled router was seen and its signal; no MAC, SSID, key,
  fingerprint, IMEI, coordinates, raw packet or arbitrary user text is returned.
- V52 tracker-state fence bits from fixed argument 15, including simultaneous
  SOS/fence bits without changing the existing alarm classifier or ACK.
- Successful socket handoffs for `CR`, `UPLOAD` and `WIFIFENCE`, including the
  requested upload seconds, independently of observed command responses.
- Optional operator markers for Home, departure, return, router power and watch
  restart. These are human observations, not facts verified by the gateway.

`fresh` uses the existing provisional two-minute age / 15-second future-skew
limits. Buffered `UD2`, stale, future and repeated reports cannot increase
fresh-evidence counts. A fresh sighting is not a confirmed Home match: signal,
repetition and Home publication remain separate. Both fence bits can be shown;
they are not forced into a claimed transition. Fence source remains
`unconfirmed`; all reports have `homeClaim: false` and `nativeFenceAccepted:
false`.

Only 256 timeline entries and 256 replay keys are retained. Aggregate counters
cover the whole window; `droppedEntries` explicitly reports timeline truncation.
The report gap is receipt-to-receipt, including buffered reports, so inspect its
time classification. Handoffs before capture starts and failed/partial socket
writes are not proof of absence of commands. A gateway restart discards the
capture; export its redacted report before restarting. A watch restart can be
marked while keeping the gateway running. The instantaneous connection flag
does not establish continuous connectivity throughout a test.

No capture data changes Home, GPS, journey distance, alert classification,
notification delivery or reporting settings. Capture errors are isolated from
packet ACK, SOS and command handling. Routine downlink logs now redact native
fence radio fields as well.

## First run: stationary baseline

After pulling this branch, restart the gateway once. In a second PowerShell
terminal, from `gateway`:

```powershell
npm run wifi-home:fence -- --start
npm run wifi-home:fence -- --mark=at_home
```

Leave the watch near the enrolled router and the gateway running for 30 minutes.
Let its existing reporting policy operate normally. This first run measures the
current baseline; zero fence packets is expected to be inconclusive while the
native fence has not been provisioned. It cannot establish that native fencing
works or fails. No nighttime outing is required.

Then collect the redacted evidence:

```powershell
npm run wifi-home:fence -- --report
```

The tool returns immediately; capture runs inside the gateway and stops collecting
after 30 minutes. To inspect progress use `npm run wifi-home:fence`; to finish
early use `npm run wifi-home:fence -- --stop`. Start/stop/mark requests are never
automatically retried after an uncertain HTTP response. Stop/mark require the
current capture ID, preventing a stale operation from modifying a newer window.

`npm run wifi-home:fence -- --preview` prints the redacted documented command
shape offline. There is deliberately no `--send` or `--apply` option.

## Native trial and reporting-policy acceptance

### Stationary baseline completed

The operator's 8 September UTC capture completed all 30 minutes: nine `LK`
heartbeats about 218 seconds apart, one `TKQ`, no location/radio reports, no
router sightings, no fence packets and no captured `CR`/`UPLOAD`/`WIFIFENCE`
handoffs. All 11 entries were retained. The session was connected at report
retrieval. See the [redacted capture](../testing/wifi-home-stationary-2026-09-08.json)
and [acceptance interpretation](../GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md#completed-stationary-baseline--8-september-2026-utc).

This establishes the stationary reporting gap in the current integration. It
does not prove a defective native fence, a particular sleep mode, or an ignored
upload command. The capture contains no current watch upload setting. A later
operator-supplied `ts#` response reports **300 seconds and 44% battery**, on
firmware **C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29**. This matches
Guardian's ordinary five-minute band at that battery level. Readback time was
not supplied; it does not establish the setting throughout the earlier window
or actual report delivery. The longer gateway log remained at zero observer
reports for approximately 36 minutes 42 seconds.

There is also a confirmed Guardian timing incompatibility: the passive observer
requires three strong reports at gaps of at most 60 seconds, and evidence expires
after 120 seconds. A synthetic replay reaches `matched` for ten-second gaps;
300-second and 600-second gaps repeatedly restart at one-match `candidate`.
Even regular five-minute reports therefore cannot establish or sustain this
match without other fresh observations. Moving to ten minutes alone cannot fix
either this mismatch or the separate absence of received reports. A successful
short burst does not validate continuous Home availability.

The following supplier details are still needed for general native provisioning
and recovery; the separately requested experiment does not resolve them:

1. Exact command for one 2.4 GHz radio, treatment of unused slots, and the
   supported number of zones (guide: two; protocol example: three).
2. Readback, removal and restoration commands, including whether changing one
   entry affects other stored zones and whether settings persist after reboot.
3. On firmware `C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29`, does
   `UPLOAD,300` require a location/radio report every five minutes while
   stationary/screen-off, or are reports conditional? Explain the observed
   heartbeats without decoded reports, any separately documented operating-mode
   requirement, and whether Wi-Fi fence detection/alarms operate independently
   of ordinary reporting.
4. Exact departure/return payloads, distinction from GPS fences, handling of
   router loss, and how to obtain current fence state after a reconnect/restart.

This question list is prepared for supplier clarification; no message has been
sent. The operator-requested one-router experiment above may proceed separately;
it does not establish an undo command or production readiness. A ten-minute
normal baseline remains a later acceptance step, rather than an assumed cure
for the observed lack of stationary reports.

### Remaining controlled trials

Once provisioning and removal are documented and implemented, test one change
at a time with redacted captures:

1. Native setting, response and subsequent behaviour; restore/remove and verify.
2. Known-Home stationary observation for several ordinary upload intervals.
3. Controlled departure/return, including signal near the house boundary. Check
   whether fence alarms arrive independently of GPS/ordinary uploads.
4. Router loss/restart while the wearer stays home; do not label router failure
   as proof the wearer departed. Unknown routers must not establish Home.
5. Watch restart, gateway restart and connection loss; establish how current
   fence state can be recovered without inventing an indefinite Home claim.
6. After fence acceptance, pilot a 600-second normal automatic baseline while
   preserving SOS/outing overrides. Compare detection delays and battery use
   under comparable conditions before replacing the normal battery bands.

Fresh Home map/hero/ordinary WhatsApp agreement remains a live acceptance item.
Native fence data must not replace GPS observations, create trips or alter frozen
SOS locations. Absence of an exit alert is not perpetual proof of Home presence.

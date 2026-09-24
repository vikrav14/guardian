# Pre-implementation short-walk evidence — 14 September 2026

This is the sanitized PR checkpoint recorded before bounded GPS buffering was
implemented. Status statements and next steps below describe that earlier
checkpoint. For current behavior and acceptance limits, see
[the recovery timeline](home-wifi-short-walk-recovery-2026-09-14.md).

## Short-walk review and latest physical acceptance — 14 September 2026

**Status:** draft/unmerged. Browser decoding is fixed; short-walk capture and Home renewal remain open. Wi-Fi loss alone must never establish departure.

### Latest gateway logs resolve the GPS and recovery questions

`Pasted text(20260914-112547).txt` supplies `source=gps gps=A` positions. Distances use the previously shared Home pin/50m radius. Accuracy is **not supplied**, so policy uses its default 30m margin. Coordinates, identifiers and command frames are omitted.

| Walk / GPS source time (MUT, UTC+04:00) | Distance from saved Home | Current boundary classification without Home priority |
| --- | --- | --- |
| Second walk, four samples around 13:36–13:38 | 20.9m, 26.0m, 34.1m, 26.0m | All uncertain; none proves exit |
| Third walk, 14:58:13 | 106.7m | Outside: exceeds 50m + 30m |
| Third walk, 14:58:58 | 41.3m | Uncertain; does not prove return |

The second walk's four samples connect over approximately 59.6m but remain near Home. The builder blocks generic movement while inside or uncertain in an active safe zone; the log has no exit there. This supports an existing boundary-policy explanation for its missing journey, distinct from the third walk. Sample distances do not establish the complete physical path or justify treating indoor jitter as trips.

### Third walk: credible outside GPS arrives during Home priority

Capture `386051d30fec03e102683f82`: stopped at elapsed 936s; all 25 entries retained, zero drops; 16 fresh reports (two GPS-valid), 12 Home sightings, four heartbeats, one CR/response and three markers. No native fence bits or UPLOAD/WIFIFENCE handoffs.

| Event | Mauritius time | Evidence |
| --- | --- | --- |
| Departure marker | 14:56:39.179 | Operator marker |
| Last Home source before GPS | 14:57:05 | -61 dBm; received 14:57:06.349 |
| Home publication acknowledged | 14:58:10.333 | Source 14:57:05; expiry 14:59:05 |
| First GPS receipt | 14:58:17.352 | Empty scan; 47.648s before expiry |
| Second GPS receipt | 14:59:01.420 | Empty scan; 3.580s before expiry |
| Home expired / cleared | 14:59:05 / 14:59:05.379 | `observation_expired` |
| Return marker | 14:59:59.697 | Marked walk 200.518s |

Both GPS reports retain the observer's matched Home state. Empty GPS scans preserve the prior Home expiry without renewing it. `wifi-home-tracking.js` holds movement while Home priority exists, and `server.js` skips journey/geofence/dwell processing. **No GPS-valid report arrived after expiry** to release that hold.

The GPS samples span 69.4m over 45s, not the full walk. Both have `persist ... reason=moved` logs: raw device/history persistence, **not journey creation**. No geofence/closure appears in this window; the diagnostic still lists only the 13:13 completed walk for today.

**Read-only production-policy replay:** first GPS classifies outside, second uncertain; both return `home_wifi_detected` holds at receipt time. Post-expiry non-GPS remains held as `awaiting_fresh_gps_after_home`. Injected clock/no-op side effects reproduce the policy path, not historical async decisions (unlogged; second sample has only 3.580s margin). Outside GPS and persistence logs strengthen the diagnosis. No further walk/log request is currently needed.

### Return and stationary reporting

The first post-return Home sighting arrives at 15:00:36.564 (+36.867s), followed by a 340s report gap. CR at 15:06:12.004 follows the 15:03:11.806 heartbeat by 180.198s. **The new console explicitly attributes this to automatic `packet_silence` recovery.** Three -37 dBm Home reports arrive at 15:06:25.883, 15:07:01.444 and 15:07:19.278; matched state is logged at the third (+439.581s after return), followed by an untimestamped Home-display publication line. This is not an exact first-publication clock.

The final checker records a later acknowledgement at 15:10:16.493, source 15:09:03, expiry 15:11:03 and clear 15:11:03.460. Do not call that latest acknowledgement first return detection. No CR occurred during the marked walk; the wider console also shows automatic recovery before the walk, so this is not an unassisted-cadence benchmark.

Stationary capture `887c6a2bc0f2c7d7d6bafdf4`: 11 fresh reports, ten Home sightings (-72 to -60 dBm, all above -75), three heartbeats, two CRs/responses, no drops. CRs at 14:38:12.089/14:46:12.148 are 480.059s apart; reports begin 3.933/4.219s later. A 309.591s report gap spans expiry 14:43:02 (clear .770); another cycle has source 14:49:02, expiry 14:51:02, clear .684. The new console confirms automatic packet-silence recovery for both CRs, matching their 180.199/180.161s heartbeat gaps and `2 × applied interval + 60s` recovery rule. Heartbeats do not renew radio evidence. Keep expiry safeguards; stronger RSSI does not fix missing reports.

### Verified browser fix and next implementation boundary

`19ed4ec` fixes signed Flutter web polyline decoding with four synthetic regressions/Chrome gate. First walk: four aligned GPS observations, v3, 138s, 0.122km, intervals 12/72/54s, Home exit 13:13:02/entry 13:15:20; `home_wifi_detected` closure needs no start anchor. App minimum is 20m, with no general duration/driving-speed floor. Reloaded screenshot confirms **one trip, 0.1km, four GPS points, 13:13–13:15, route/story panels**; displayed 3m versus stored 138s. Replay UI remains unverified.

The [short-walk review](https://github.com/vikrav14/guardian/blob/feat/v52-wifi-home/docs/testing/short-walk-review-2026-09-14.md) records proposed provisional GPS collection and partial routes. Preserve credible samples through Home priority, then validate coherent movement before promoting a journey; include loss/expiry without movement, indoor GPS jitter, network drift, ordering/duplicates, binding changes and late callbacks in regressions. Do not fabricate a Home route anchor or a complete walked distance. Nearby activity within Home needs separate treatment from an exit. Sampling changes must respect battery/manual/SOS behavior.

Proposals are **not implemented**; native WIFIFENCE remains unproven. Sampling/state changes overlap #119/#120 integrations; preserve their gates and approved edition split.

**Validation:** four checks passed at `19ed4ec`: gateway, Firestore, dashboard, Flutter analysis/native/Chrome tests/web build. [CI](https://github.com/vikrav14/guardian/actions/runs/34832664307). This update adds log analysis/read-only replay only; runtime and device settings are unchanged.

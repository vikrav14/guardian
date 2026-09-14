# Home Wi-Fi short-walk recovery — 14 September 2026

PR #116 retains the existing private pilot gates. This change addresses GPS
samples arriving during Home priority and disappearing from journey processing
before the 120-second Home radio lifetime ends. It does not replay old operator
logs or backfill stored journeys. Physical acceptance on the new code is pending.

**Merge boundary:** recovery is now a separate default-off experiment controlled
by `WIFI_HOME_WALK_RECOVERY_EXPERIMENT_ENABLED`. Home display opt-in and ordinary
setup do not enable it. With the flag absent or false, the runtime creates no
recovery buffer or timer; the existing Home observer/display continues normally.
The experiment also requires the configured observer/display pilot and a usable
publisher. `wifi-home:check` reports `walkRecoveryEnabled` and
`walkRecoveryActive` separately. Restart is required after changing configuration.
The pending hardware gate applies to enabling/accepting this experiment, not to
merging its disabled code with the established private Home pilot.

## Expected timeline

These are the third walk's supplied timestamps, illustrating equivalent future
input on the new code; they are not a claim that its missing record was repaired.
All times are Mauritius time (UTC+04:00).

| Time | Evidence | New behavior |
| --- | --- | --- |
| 14:56:39 | Operator leaves | A marker alone creates no journey or departure. |
| 14:57:05 | Last qualified Home radio source | Keep Home presentation until its existing expiry. |
| GPS source 14:58:13; receipt 14:58:17 | Position about 107m from saved Home | Retain a provisional GPS sample. No exit alert or journey yet. |
| GPS source 14:58:58; receipt 14:59:01 | Position about 41m from Home; 69.4m movement between samples | Retain corroboration. Home still has priority. |
| From 14:59:05 | Home radio expires | The one-second in-memory check validates the batch and current binding, then performs one cancellable zone read. If all checks pass, the GPS-proven exit and active journey use the first sample's original 14:58:13 time. A further GPS report is not required. |
| 14:59:59 | Operator returns | The marker is not sensor evidence and cannot close the journey. |
| When fresh Home qualifies again | Repeated enrolled-router evidence | Existing Home logic closes the journey at its last GPS endpoint. With only these two samples, record approximately 0.069km over 45s, with no invented route back to Home. |

The completed Journey view becomes eligible after closure, under the existing
GPS/source and distance rules. The map uses the existing post-expiry location
selection; buffering does not change location presentation. There is no new
"possible walk" UI or new live-trip screen.

## Bounded qualification

- Only the already configured watch with both Home observer/display pilot gates
  and an unexpired verified Home/owner/plan binding can collect candidates.
- Retain at most 16 GPS samples, each less than 120 seconds old at recovery.
  They must be newer than the last qualified Home observation, ordered, valid
  GPS with valid coordinates and no future source time. Network estimates do
  not count. If satellites are supplied, require at least four.
- Use the existing boundary uncertainty function: unknown V52 GPS accuracy gets
  the existing 30m margin. Supplied accuracy above 50m cannot qualify this
  narrower recovery path. These are policy margins, not measured accuracy.
- Start candidates at a GPS position classified outside Home. At least two
  samples must span 20 seconds; adjacent gaps cannot exceed 60 seconds, and
  coordinate-derived segment speed cannot exceed 3m/s (10.8km/h).
- First-to-last displacement must exceed or equal the sum of their uncertainty
  margins, with a 20m minimum (normally at least 60m for V52's unknown accuracy).
  A GPS sample classified confidently inside Home discards the candidate, to
  avoid promoting an isolated outside jump followed by an inside reading.
- Only expiry of the same Home radio observation can promote the batch. Weak,
  malformed, missing or different-router evidence does not trigger replay.
  Subsequent live GPS continues through the existing normal tracking path.
- Renewed Home observations, revoked/expired/replaced bindings, newer live GPS,
  stale candidates, stop/restart or a changed/removed Home discard pending work.
  The zone read has a five-second cancellation deadline. Recheck binding,
  generation and freshness after the read, before synchronous route mutations.
- Recovered geofence evidence and routes preserve the original GPS source times.
  No raw telemetry/history, dwell, heartbeat, SOS or reporting-command pipeline
  is replayed. Fresh Home later closes the route through the existing path.

This deliberately does not guarantee every small outing. A lone fix, a loop
without sufficient corroboration, a confirmed-inside return before qualification,
or walking entirely inside/uncertain around Home can remain unconfirmed. The
earlier near-Home test's 21–34m samples still do not establish an exit. Broader
within-zone activity remains separate work; steps cannot fabricate GPS routes.

## Verification and remaining work

Synthetic tests exercise the real buffer, publisher context, cancellable read,
geofence and journey builder through expiry and later Home closure. They cover
stationary jitter, single outliers, approximate sources, impossible movement,
reordered/duplicate/future/stale input, revoked/changed bindings, edited zones,
newer live GPS, late callbacks, timeout and stop. Dispatcher coverage checks
that the retained samples keep their resolved GPS provenance and original time.
No pilot coordinates or identifiers are included in test fixtures.

The existing Home priority, SOS failure isolation, ordinary GPS/journey, geofence,
reporting and entitlement suites remain regression gates. Record final CI results
in PR #116. New physical acceptance is still required before accepting walk
recovery beyond an explicitly enabled private experiment.

Both #119 and #120 also change `gateway/src/server.js`; preserve this location
hook and startup callback when reconciling those integrations. Their edition
split, feature gates and telemetry/consent processing are unchanged here.

The earlier reporting gap remains: a recovered route does not cause extra CR,
UPLOAD or native WIFIFENCE commands. It does not extend Home freshness or tune
RSSI/battery/manual reporting. Return display can still be delayed until the
watch supplies enough fresh Home-radio observations.

## Operator check after pull/restart

Use the existing bounded capture/markers and read-only journey diagnostic.
The redacted `[wifi-home-walk]` log records `outcome: recovered`, sample count,
original first/last GPS timestamps and any failed alert/flush writes. A recovered
active journey is saved by the existing later closure; the log does not claim
that the app rendered it. No new enrollment or watch setting is required.

Alert/flush delivery runs independently after the in-memory route is recovered.
Slow writes cannot hold the next candidate behind an old batch; failures emit a
separate `delivery_failed` diagnostic without retrying a historical departure.

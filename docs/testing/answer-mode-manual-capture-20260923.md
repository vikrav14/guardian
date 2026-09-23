# V52 answer modes: successful reference transitions, 23 September 2026

> **Latest checkpoint:** All six private records have now been supplied and
> decoded. Auto uses 3G ACALL with the captured guardian number in `00…`
> format; Manual uses 3G APPLOCK,JT-0 then 3G ACALL,0. Reference Auto and
> Manual worked physically. A restricted Guardian replay is implemented;
> its physical transitions remain pending. See the
> [Guardian trial instructions](answer-mode-captured-trial.md).

## First Manual result

The operator reports selecting **Press to answer / Manual** in AnyTracking on
the existing Guardian pilot. The submitted recorder excerpt includes the exact
two-command supplier exchange and both watch replies. After reporting restoration
of the Guardian route, the operator called the watch: it kept ringing, did not
auto-answer, and two-way audio worked after manual answering.

Record **operator-confirmed physical Manual behavior after this reference
selection and reported return**. The call timestamp and ring duration were not
measured in the supplied evidence. Fresh post-return Guardian telemetry is still
not supplied. This does not yet prove a Guardian-generated command transition.
PR #115 remains draft; no production setter is enabled.

## First Manual exchange

The recorder started at 16:34:42.308 UTC and connected to the supplier at
16:36:51.637 UTC. Private answer capture was enabled.

| UTC on 23 September | Direction | Prefix | Length field | Payload | Private record |
| --- | --- | --- | --- | --- | --- |
| 16:37:21.872 | Supplier to watch | 3G | 000c | APPLOCK,JT-0 | 1 |
| 16:37:21.873 | Supplier to watch | 3G | 0007 | ACALL,0 | 2 |
| 16:37:22.642 | Watch to supplier | 3G | 0007 | APPLOCK | 3 |
| 16:37:23.219 | Watch to supplier | 3G | 0005 | ACALL | 4 |

All four lengths match the recorded payload bytes. The downlinks have 12 and
7 payload bytes respectively. Both downlinks were observed before either
reply; the timestamps do not establish a required inter-command delay.
The private recorder reports all four entries saved. The actual private file
and completed normal log have not yet been uploaded for independent inspection.
The UI selection is operator-reported; the exact UI click timestamp is absent.

In Mauritius time, the command pair was observed at approximately **20:37:21**.
The earlier CONFIG upload reported JT:0 before the selection; it is not evidence
that this Manual request was applied. Both replies are bare acknowledgements
with no returned mode or execution result.

## Difference from the failed Guardian Manual attempt

| Property | Guardian Manual trial on 22 September | Reference Manual selection on 23 September |
| --- | --- | --- |
| Prefix | SG | 3G |
| First payload | APPLOCK,JT-1 | APPLOCK,JT-0 |
| APPLOCK length field | 000c | 000c |
| Additional answer command | None | ACALL,0 |
| Watch reply | Bare APPLOCK | Bare APPLOCK and bare ACALL |
| Physical result | Operator reported continued automatic answering | Operator confirms ringing until manual answer, then two-way audio, after reported Guardian return |

This is evidence that the observed reference sequence differs from the tested
Guardian implementation. It is **not yet a demonstrated fix** or proof that
one particular difference caused the failure. The supplied communication
example labels JT-1 Manual and JT-0 Auto; the observed pair must therefore be
retained as a pair associated with the operator's Manual selection, rather
than reinterpreting JT alone as a proven inverse mapping.

ACALL,0 is now an observed literal command for this reference action, rather
than a guessed replacement. Its independent behavior, any prerequisite, the
necessity of either command remain unverified. The later private records below
now establish the Auto counterpart for that run.
The earlier 22 September ACALL with length 0013 and a redacted argument remains
a distinct exchange; this capture cannot reconstruct its missing argument.
Do not infer ACALL,1 or an Auto sequence by flipping values.

## Latest reference run: Auto then Manual both observed working

The operator reports these events on 23 September in Mauritius time:

| Local time (UTC+4), approximate | Operator action / physical result |
| --- | --- |
| 21:04 | Selected Auto; the incoming call auto-answered and audio worked both ways |
| 21:05 | Selected Manual; the incoming call kept ringing instead of auto-answering |
| 21:07 | Restored the Guardian route |

The second Manual call's answer/audio result was not separately described;
the earlier Manual call above already established two-way audio after answering.
Call delays/ring durations are not measured. Fresh Guardian telemetry remains
to be supplied; the routing return is operator-reported.

The recorder run `guardian-answer-20260923-210251-301.log` started at
17:02:51.356 UTC and connected to the supplier at 17:03:09.760 UTC.

| UTC | Direction / observed frame | Private record |
| --- | --- | --- |
| 17:04:00.095 | Supplier ACALL, prefix 3G, length 0013, 19 payload bytes, one redacted argument | 1 |
| 17:04:01.210 | Bare watch ACALL reply, prefix 3G, length 0005 | 2 |
| 17:05:42.656 | Supplier APPLOCK,JT-0, prefix 3G, length 000c | 3 |
| 17:05:42.657 | Supplier ACALL,0, prefix 3G, length 0007 | 4 |
| 17:05:43.746 | Bare watch APPLOCK reply, prefix 3G, length 0007 | 5 |
| 17:05:44.385 | Bare watch ACALL reply, prefix 3G, length 0005 | 6 |

The Auto exchange now correlates with the operator's reported UI action and
successful incoming call. There is no APPLOCK Auto downlink in this supplied
run. The watch began from the previously tested reference Manual configuration;
this does not establish that ACALL alone initializes every watch configuration.
Manual repeats the earlier exact pair and now has a second reported physical
disable result.

All six private records were subsequently pasted by the operator and decoded.
They match this run's timestamps, protocol ID, directions and frame lengths.
Auto is 3G `ACALL,<captured guardian number>`, length `0013`. The argument
has 13 ASCII digits in international `00…` form and matches the earlier
center/SOS1 report. The number and frame hex are retained privately, not in
this repository. Manual's two frames are exactly as listed above.

The uploaded normal log is UTF-16, contains 35 JSON records through
17:08:47.814 UTC and confirms six successful private writes. It has no
relay-stopped event. The two accompanying dd_BackgroundDownload files are
Visual Studio installer logs and contain no answer-mode evidence.

## Next evidence

1. Run the [restricted Guardian trial](answer-mode-captured-trial.md) using the
   existing private capture file. No new AnyTracking capture is required.
2. Record fresh Guardian telemetry and physical Auto then Manual call results.
3. Test caller scope separately: the number-bearing command suggests a caller
   selection but does not prove exclusivity or rejection of other callers.
4. Keep emergency-only behavior, expiry and offline restoration separate from
   the reference pass; see the [app/SOS proposal](../services/watch-answer-sos-design.md).

## Connection recovery during this run

Earlier local listener/endpoint listings did not establish a working public
route. The old capture endpoint failed a laptop TCP probe while Guardian's
endpoint passed. A later ngrok display explicitly reported reconnecting with
Listener closed. After restarting ngrok, restoring its endpoints and starting
a fresh recorder, the actual supplier connection and two-way frames above
were observed. These facts do not establish whether laptop sleep caused the
failure. A new recorder startup had also failed generically; port contention
was a hypothesis, not proven by the submitted output.

The operator reports the Guardian return SMS was restored. The recorder's
routingRestored:false is a fixed conservative field, not an observation of the
separate Guardian gateway. Obtain fresh gateway telemetry separately.

## Scope of this update

The exact private capture is now decoded. A strictly authenticated operator
replay and tests have been added; no customer control or SOS switching is
enabled. Reference physical passes remain distinct from Guardian-generated
acceptance, which the next two calls must establish.


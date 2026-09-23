# V52 Manual selection: exact reference exchange, 23 September 2026

## Current result

The operator reports selecting **Press to answer / Manual** in AnyTracking on
the existing Guardian pilot. The submitted recorder excerpt now includes the
exact two-command supplier exchange and both watch replies. The operator also
reports restoring the Guardian route. A physical incoming-call result after
this Manual selection and fresh post-return Guardian telemetry are not yet
supplied. PR #115 remains draft; no production setter is enabled.

## Recorded exchange

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
| Physical result | Operator reported continued automatic answering | Not yet reported |

This is evidence that the observed reference sequence differs from the tested
Guardian implementation. It is **not yet a demonstrated fix** or proof that
one particular difference caused the failure. The supplied communication
example labels JT-1 Manual and JT-0 Auto; the observed pair must therefore be
retained as a pair associated with the operator's Manual selection, rather
than reinterpreting JT alone as a proven inverse mapping.

ACALL,0 is now an observed literal command for this reference action, rather
than a guessed replacement. Its independent behavior, any prerequisite, the
necessity of either command, and the Auto counterpart remain unverified.
The earlier 22 September ACALL with length 0013 and a redacted argument remains
a distinct exchange; this capture cannot reconstruct its missing argument.
Do not infer ACALL,1 or an Auto sequence by flipping values.

## Next evidence

1. After a fresh Guardian connection, call from the same approved number and
   record whether the watch waits for manual answering or still auto-answers.
   Record audio if answered and keep the existing caller configuration.
2. Review both saved files, retaining exact relevant bytes privately.
3. If Manual works, capture the reference Auto selection and physical result
   before implementing or claiming a complete Guardian on/off control.
4. Only replay an observed sequence through a bounded operator trial with the
   exact prefix, payloads, ordering and length fields, then verify behavior
   physically. Handoff and bare replies remain separate from applied state.

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

Documentation only. No new watch command was sent by the repository update,
no runtime or customer control changed, and no new physical pass is claimed.

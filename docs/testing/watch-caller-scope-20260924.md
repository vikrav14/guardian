# V52 caller comparison: original guardian vs second approved phone

Operator follow-up to the 23 September 2026 20:45 UTC PHBX slot-2 capture
(24 September Mauritius local date). Exact follow-up call times were not
supplied. PR #115 remains draft.

## Reported physical results

The operator confirmed the newly added contact appears in the watch phonebook
and sent the prepared return-to-Guardian routing SMS. They then changed modes
through the Guardian app and made these calls:

| Requested mode | Original configured guardian | Second approved phone |
| --- | --- | --- |
| Manual | Kept ringing | Kept ringing |
| Auto | Automatically answered | Kept ringing |

The operator specifically reports changing Auto using the second phone. The
current request path still uses the watch's backend-owned captured caller
configuration: the requesting handset is not a caller-selection mechanism.
This is consistent with the original number auto-answering and the second
number ringing under the same Auto setting.

The operator clarified that the original number is the primary contact and
therefore expected it to auto-answer. That number also matches the configured
Auto capture. This comparison does not separate primary/SOS-role eligibility
from the number supplied to ACALL, and must not establish either as the sole
firmware rule. The second contact was approved for calling but was not selected
as a new Auto caller. Its ringing behavior is expected for the current setup,
not a failed attempt to configure that second number for Auto.

The second caller is no longer blocked from ringing. Its phonebook entry was
added through AnyTracking, correlated with serial 2 in the preceding capture,
and is now physically visible. This is not evidence that Guardian's add-contact
form has provisioned a number. No live managed inventory was imported here.

## Acceptance and limits

- Passed on this pilot/configuration: differentiated Auto behavior for these
  two approved callers, with both ringing in the Manual baseline.
- Passed: operator reports the new phonebook contact is visible and its calls
  reach the watch. Treat slot 2 as occupied by the captured addition.
- Return SMS and successful subsequent Guardian app controls are reported by
  the operator. A fresh Guardian session/downlink excerpt was not included.
- New call timestamps, second-caller manual pickup/two-way audio, and a fresh
  original-caller audio check were not supplied. Earlier audio acceptance is
  separate; do not silently extend it to this new caller.
- Final tested mode is Auto. Final Manual restoration after this comparison
  is pending; send Manual and verify the original caller waits for a tap.
- Not established: whether primary/SOS role is an additional Auto prerequisite,
  unknown-caller rejection specifically while Auto is on,
  multiple simultaneous Auto-answer numbers, changing the configured caller,
  every eligible SOS/family caller, reboot persistence or device-side expiry.
- No real SOS/fall callback or automatic restoration was tested.

The result supports caller-specific behavior on the tested watch; it is not a
universal claim for every number or firmware. Per-command receipt fields such
as callerScopeVerified remain conservative: a bare reply cannot reproduce this
external physical comparison.

## Product implication

An opted-in emergency callback policy can be designed to request Auto for the
configured guardian on a fresh trusted SOS/fall, then restore the normal mode.
The existing commands include no incident tag or proven expiry. An ordinary
call from that same number during Auto also auto-answers. Activation,
notification independence, durable restoration, reconnect handling and physical
SOS/fall acceptance remain implementation gates in
[the emergency design](../services/watch-answer-sos-design.md).

This update changes documentation only; it sends no watch commands, changes no
live policy, and does not enable emergency automation.

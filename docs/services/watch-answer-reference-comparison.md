# V52 auto-answer: official-platform comparison

**Status:** Research and proposed operator test; no physical pass or wire-command
correction established. PR #115 remains draft. Customer auto-answer stays disabled.

## Why this comparison is next

The pilot has failed automatic answering after the documented APPLOCK/JT command,
both hexadecimal-letter cases, a recognized on-watch SOS1 caller, and a reboot.
Startup CONFIG reported JT:0 after both requested modes; that field has not been
validated as an applied-mode readback. Repeating the same command is not a new test.

A comparison with the supplier's own app/platform can establish whether this exact
watch, firmware, SIM and caller can auto-answer through its intended control path.
Success would give us a working reference to compare with Guardian. Failure would
leave device, configuration, caller and carrier conditions unresolved; it would
not, by itself, prove that the model lacks the feature.

## Read-only investigation — 21 September 2026

### Guardian startup handling

At runtime/helper commit `bc38754`, `gateway/src/protocol/gt06.js` creates a bare
same-command ACK for unknown commands. `gateway/src/server.js` writes those ACKs
before processing the resulting events. Thus the logged `appcontacttel`,
`APPANDFNREPORT` and `eicard` startup messages are not simply dropped because
their semantic handler is unknown.

CONFIG already receives CONFIG,1; LK and the identification exchanges also have
reply paths. APPLOCK replies intentionally do not receive another ACK. This audit
does not establish that every reply is correct for the firmware, but no missing
startup ACK has been demonstrated as the cause. Do not change these replies based
on protocols for another manufacturer or on the wording of an "unknown" log.

### Official AnyTracking Android app

Source provenance:

- The [supplier's public platform login](https://www.igps123.com/RfLogin/LoginRF.aspx)
  links its Android download to
  [AnyTracking APK](https://ap2.iotsafe.net/anytracking/anytracking.apk).
- Retrieved public APK: package `com.fw.gps.anytracking`, version `5.2.94`,
  version code `950294`, 53,455,599 bytes.
- SHA-256: `edeccda1328deb9f224c57e34677c9543c4420c0ff01a26b6a092e6a54ee069b`.
- Static inspection used JADX 1.5.6 from its official release. The app was not run,
  no account was accessed, and no command API was invoked. No APK, decompiled
  source, embedded credential, contact or location data is included in this repo.

The APK's `com.fw.gps.anytracking.activity.Setting` class contains a two-choice
answer-mode dialog. Its English resources label the choices Press to answer and
Handsfree auto answer. In that dialog, selecting the choices sets these values:

| App UI choice | App-to-server command type | App-to-server parameter |
| --- | --- | --- |
| Press to answer | ANS | 0 |
| Handsfree auto answer | ANS | 1 |

The save path calls `SendCommandByAPP`, with a server-side DeviceID, CommandType,
Model and a string parameter. The parameter field is spelled `Paramter` in the
app. Its settings response uses a field named `ans`. The network wrapper sends
this to the supplier's web service, not to the watch socket.

Reproduction anchors for this exact APK: Setting's `v0` creates the two choices;
`w2.onCheckedChanged` maps the selections; `y2.onClick` invokes `S0`;
`S0` constructs SendCommandByAPP; `y.p` is the web-service wrapper. The class
also contains another answer-mode dialog and model-specific branches.

**These are API values, not V52 wire values.** The app obtains its numeric device
model from the server. We have not established which branch the pilot's account
selects or the server's translation from ANS to a watch command. In particular:

- ANS could translate to the exact APPLOCK command already tested.
- ANS could translate differently for the pilot model or firmware.
- An app's stored ans value or success toast is not physical acceptance.
- This finding does not justify sending ANS over TCP/SMS, reversing the documented
  JT values, or copying commands from a different model.
- No new wire-level command, prerequisite or working solution was found in the APK.

The [official V52 guide](https://ireachfar.com/wp-content/uploads/2023/07/User-Guide-RF-V52-Smart-GPS-Watch-U.pdf)
describes auto-answer for SOS/family callers after two rings. The supplied
`1. Switch-Server SMS-Commands(1).pdf` recommends testing on the supplier platform
and documents switching the server and returning to one's own platform.

## Proposed comparison, with a concrete return path

This procedure is prepared, not executed or approved for routing. Temporarily
using the supplier platform sends the watch's telemetry there and interrupts
Guardian's live telemetry. Agree that limited test with the owner before changing
routing. Do not request credentials or private status replies in chat.

1. **Preflight without changing the watch.** Confirm the operator can use their
   own AnyTracking account/device login, identify this exact watch, and view its
   available Answer mode options. An offline or cached settings screen is not
   proof of the current watch state. Do not save a mode while the watch still
   points at Guardian; it could leave a queued supplier command for a later login.
2. **Prepare restoration before switching.** Keep Guardian and ngrok running.
   Read the current ngrok TCP endpoint and privately compare the watch's supported
   ts# status reply if it reports the server. Write down the exact current
   `ip,<guardian-host>,<guardian-port>#` return SMS using the existing documented
   provisioning path. Do not reuse an old tunnel address from this document or
   restart ngrok during the comparison.
3. **After owner agreement, connect to the reference platform.** The supplied
   switch-server sheet specifies `ip,a.igps123.com,7720#`. This is the documented
   target, not a claim that its current availability or account routing has been
   tested. Require fresh online telemetry in the correct owner's AnyTracking
   device before proceeding. If that cannot be established, restore Guardian.
4. **Change only answer mode.** Keep the same watch/SIM, approved caller, SOS and
   phonebook entries, caller restrictions and sound profile. Record the baseline.
   Explicitly select the automatic-answer option, record the local time and
   reported completion, then make one normal incoming call while the watch is
   beside the informed operator and untouched. Record whether it answers, ring
   count/elapsed time and two-way audio if connected. Do not substitute voice
   monitoring/callback, open the allowlist, or modify contacts to force a pass.
5. **Restore and verify.** End the call. Select Press to answer in AnyTracking and
   verify a call waits for the wearer. Send the prepared return-server SMS.
   Confirm the pilot's identified Guardian connection and fresh telemetry, then
   verify manual answering once more. If supplier settings cannot be changed or
   confirmed, still return routing and report the unresolved mode rather than
   repeatedly sending commands. No factory reset, APN or IMEI change is needed.

Record only redacted results: app version, answer-mode choices, firmware labels,
requested mode, timestamps, fresh connection evidence, physical call outcome,
and restoration outcome. Do not publish account details, phone numbers, raw
telemetry or full screenshots containing them.

## How the result guides implementation

| Reference-platform outcome | Next investigation |
| --- | --- |
| Auto answers successfully | Capture the authorized supplier-to-watch exchange in a separate, prepared test and compare exact bytes, preceding setup and reply order with Guardian. A success alone does not identify the wire command. |
| Still rings after an established mode request | Preserve the controlled result; compare device/firmware, caller/SIM eligibility and supplier-side configuration. Do not declare all V52 units unsupported. |
| Mode absent, device unavailable or request never reaches it | Treat the comparison as inconclusive; restore Guardian and resolve platform access/model support before another call trial. |

No relay, interception service, API credential use or server forwarding has been
implemented or enabled by this research. Capturing a future reference exchange
requires a separate, concrete capture setup with bounded, redacted retention.
Only an observed or V52-documented wire difference should change the gateway.

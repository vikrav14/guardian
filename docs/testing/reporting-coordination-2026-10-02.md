# Reporting and command coordination acceptance — 2 October 2026

Status: software regression passed; hardware acceptance partial. Times below
are Mauritius time (UTC+4). Do not interpret configuration or command handoff as
proof that the watch applied it.

## Starting state and preservation

- Original checkout: `C:\Users\MSI\repos\guardian`, branch
  `feat/guardian-home-wifi-setup`, HEAD `de84c09`; local Journey changes retained.
- Both PR #141 and PR #113 were still draft/open. Remote heads were `005829a`
  and `9c2437e`. Original runtime PID 17188 executed `src/server.js` from the
  original `gateway` directory, without incident-photo modules or activation.
- New integration: `C:\Users\MSI\repos\guardian-coordination`, branch
  `feat/guardian-command-coordination`; merge base checkpoint `03d8f6e` combines
  both heads. Original checkout was neither switched nor cleaned.
- Existing private `.env`, Firebase credentials, Maps configuration,
  `android-config.json`, saved Home enrollment and journey journal retained.
  Original session environment was preserved privately before restart.
- PowerShell history recovered snapshot acceptance, model `claude-sonnet-4-6`,
  and AI rotation settings. History's last recorded photo launch was trial-only;
  it did not establish the later real-SOS activation bundle.
- Read-only Meta inspection verified all seven v3 initial-alert/follow-up
  contracts APPROVED and matching. Existing Firestore capture/AI consent was
  confirmed. Automatic incident capture and the existing v3/follow-up contract
  were restored explicitly in the combined private launch environment.
- ngrok PID 10500 retained TCP `0.tcp.ap.ngrok.io:14018` → port 9000.
  Its missing HTTPS endpoint was restored at the existing approved domain
  `lidless-inward-lucas.ngrok-free.dev` → port 9001, without replacing TCP.
  Public `/health` returned 200. No Meta templates were changed or submitted.

## Software checks

- Gateway full regression: **1,598 passed**, including the direct-transport
  integration test exercising the shared gate through the real downlink.
- Covers camera/routine overlap, emergency/CR/calls/stops, expiry, authorization
  changes, latest-setting selection after a completed stop, disconnect/session
  replacement, restart ambiguity, no duplicate capture, bounded location
  recovery, critical-battery timing, persisted SOS restoration, manual/SOS
  priority and changed battery during camera deferral. Added regressions cover
  a pending request arriving while an empty query resolves and authorization
  changing during an asynchronous SIM lookup.
- Existing sequential five-photo, AI/gallery, WhatsApp-contract and Home Wi-Fi
  regression coverage remains in the passing combined suite.
- Flutter: 730 tests passed; `flutter analyze` reported no issues.
- Combined Android debug APK built and installed with `adb install -r` on
  Samsung SM-S918B; app process started. Build used existing
  `--dart-define-from-file=android-config.json` and
  `--dart-define=GUARDIAN_MOVEMENT_REMINDER_PILOT_IMEI=861397052547492`.
  ADB reverse for the existing localhost gateway configuration was restored.

## Hardware evidence, kept separate

| Check | Observation | Acceptance |
| --- | --- | --- |
| Restart/reconnect | Measurement runtime started 03:23:35; watch reconnected 03:23:54.886; one `UPLOAD,600` handoff followed by watch echo | Handoff and connection proven; firmware interval not proven by echo |
| Normal reporting | Heartbeats approximately every 90 seconds; no location before the manual CR and none between its last receipt at 03:38:32 and final sample at 03:51:37 | Ten-minute location cadence **not demonstrated**; observed post-burst silence exceeded 13 minutes |
| Urgent locating | One explicit `CR` handed off at 03:35:35.988. Ten location receipts between 03:35:40.495 and 03:38:32.031; no retry; baseline stayed 600 seconds | Bounded faster reporting demonstrated; normal-upload restoration remains unverified |
| Home | Enrollment enabled/version 1 preserved. Three matching observations qualified Home at approximately 03:36:43. Last router observation 03:38:26; sampled expiry at 03:40:28 (122 seconds old), with Home unpublished | Fresh acquisition and expiry demonstrated; no extension and no repeated CR |
| Independent fall | No new physical fall trigger performed in this acceptance run | Pending operator |
| SOS capture regression | No new physical SOS trigger performed in this acceptance run | Pending operator |
| Actual images | None requested by this operator acceptance run so far | Not verified |
| AI/gallery | Worker active with AI enabled; existing model/rotation retained | Configuration verified; new image analyses/gallery not yet verified |
| WhatsApp | Contracts and HTTPS destination verified; follow-up activation restored | New API send, recipient delivery, call/map/gallery opening not yet verified |

The earlier real SOS with five images/ready analyses and independent falls with
one/zero images remain prior evidence, not results of this run. A failed image
wait did not establish a competing outgoing command. Coordination is not a
proven firmware-camera fix.

A passive decoded-packet capture from 03:43:08 to 03:51:37 recorded six LK
heartbeats, zero location reports, zero stale/invalid reports and zero command
handoffs. This is evidence of missing location-upload packets during that
window, not merely missing usable GPS. Stationary/sleep behavior or another
firmware setting has not been established as the cause. Do not hide this gap
with repeated CR requests or a Home freshness extension.

After saving that evidence, the final tested code was restarted at 03:51:56
(PID 28684). The watch was connected again by 03:53:22 with one `UPLOAD,600`
handoff and no active camera wait. Both listeners and the photo/AI worker started; the existing
HTTPS health endpoint returned 200 and ngrok PID 10500 remained unchanged.
The restored HTTPS endpoint is live agent state; the gateway launcher does not
recreate ngrok endpoints after an ngrok/laptop restart.

## Remaining controlled checks

1. Investigate normal upload silence with controlled stationary/moving watch
   observations and exact-firmware supplier evidence. Do not treat an UPLOAD
   echo as acceptance or infer a firmware sleep policy without evidence.
2. Exercise real departure/return and verify bounded outing restoration. Home
   acquisition/expiry passed in the CR observation; outdoor transitions remain
   untested in this run.
3. With the operator and informed existing test contacts, perform an independent
   fall-alarm test and a separate physical SOS-button test outside the incident
   grouping window. Never put a person at risk to create a fall.
4. For each, record initial alert/call/map availability; capture requests,
   acknowledgements and actual images; AI state; signed-in gallery; WhatsApp
   transport result and recipient delivery as separate facts.
5. Observe current-policy restoration after the bounded emergency/outing window.

Private runtime and raw logs stay outside Git in this Codex task's `work`
directory. The repeatable Windows launcher is in the task's `outputs` directory.
Repository policy details: `docs/services/reporting-command-policy.md`.

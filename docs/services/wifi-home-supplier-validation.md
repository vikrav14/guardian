# V52 native Wi-Fi fence validation

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
observable conditions while retaining the setting already attempted. These are
planned tests, not additional hardware results.

| Experiment | Variable to change | Evidence sought |
|---|---|---|
| Next: stationary radio loss/restoration | Enrolled 2.4 GHz radio on, off, then on; watch stays still | Reports or fence bits correlated with radio loss/restoration, without assuming the wearer departed |
| Awake comparison if needed | Repeat the radio sequence with one protected CR attempt after restoring the baseline | Whether response/report behaviour differs during the temporary reporting burst; verify the CR handoff and reply before classifying this as an awake comparison |
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
| `V52-DataSheet(2).pdf`, page 3 | Wi-Fi fence entry/exit; supplier Android-app feature | `503c0f4f8efebbb78893f28c654f29fcf7d7e3b6dbcc374b9ba54d8285a374fd` |
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

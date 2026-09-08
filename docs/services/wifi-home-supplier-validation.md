# V52 native Wi-Fi fence validation

## Decision — 8 September 2026

Use the supplier's documented V52 operating model as the baseline. The operator
confirmed that the supplied V46/V48/V52 protocol and examples apply to this V52.
Shared model names are not a reason to reject that documentation. Preserve the
accepted V52 Appendix I alarm layout when another appendix conflicts with it.

Validate native fence behaviour before replacing normal battery reporting bands
or introducing recurring Home `CR` requests. The current battery policy,
SOS/outing overrides, radio expiry, GPS selection, journeys and notifications
are unchanged by this validation tool.

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
at the gateway and publishes an expiring saved Home anchor. It has not
provisioned the watch's native fence.

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

Before the first native setting is sent, obtain the supplier's single-router
and removal/restore instructions, then implement exactly those forms. The
repository's `CLAUDE.md` prohibits fabricated hardware commands. This is the
specific remaining provisioning blocker, not uncertainty about V52 support.

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

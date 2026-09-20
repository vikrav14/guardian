# Guardian V52 command evidence

**Home pilot, 13 September 2026 UTC:** after the update, a requested location
burst supported fresh Home recognition and app display. Radio expiry retained
**Last detected at Home · 4m ago** with current presence unconfirmed; a gateway
restart restored the original historical timestamp without fresh Home authority.
These are server/app changes with no new command, polling loop, native-fence claim
or reporting-interval change. Actual departure/return and real binding-timeout
recovery remain open; the operator paused outdoor testing for the night.
[Checkpoint evidence](testing/wifi-home-retention-2026-09-13.json) ·
[Current runbook](services/wifi-home.md#next-device-check-for-remembered-home).

Guardian supports one production watch model: **ReachFar V52**. This ledger
prevents older-model syntax, generic examples and live V52 results from being
treated as interchangeable.

## Evidence levels

- **Proven:** observed successfully on Guardian's real V52.
- **Documented:** present in the supplied V52 / shared V46-V48-V52 protocol examples and
  regression-tested, but not yet accepted on the real V52.
- **Blocked:** intentionally not automated because the exact production value
  or safe behaviour is not established.
- **Experimental:** an explicitly operator-requested private hypothesis, kept
  outside the production command dispatcher; neither documented nor proven.

## SMS provisioning

| Action | Exact command | Evidence | Notes |
|---|---|---|---|
| Set center | `pw,123456,center,<phone>#` | Proven | Real V52 returned status with the configured center. |
| Set SOS1 | `sos1,<phone>#` | Proven | Real V52 replied `sos1 ok` and reported the stored number in `ts#`. Carrier call completion is a separate acceptance item. |
| Set SOS2/SOS3 | `sos2,<phone>#`, `sos3,<phone>#` | Documented | Same vendor slot family; not yet exercised on the real V52. |
| Check status | `ts#` | Proven | Real V52 returned firmware, IDs, server, SOS, battery, language and network state. |
| Set server | `ip,<host>,<port>#` | Proven | Real V52 connected through the configured ngrok TCP endpoint. Re-send after an ngrok restart. |
| Set APN | carrier-specific | Blocked | Never copy the vendor's China example or guess MCC/MNC. Use only an exact carrier/vendor instruction. |
| Change IMEI | vendor-specific | Blocked | Identity-changing and unnecessary for normal onboarding. Do not automate. |

## TCP data commands

These commands are wrapped as `[SG*<10-digit protocol ID>*<hex length>*<data>]`
and require an active V52 gateway session. There is no SMS fallback.

| Action | Data payload | Evidence | Acceptance still required |
|---|---|---|---|
| Request location | `CR` | Proven for returned observations | Real V52 returned GPS and Wi-Fi/LBS observations. Supplier II.2 describes GPS wake-up and reports every 30 seconds for about three minutes; exact cadence and battery impact remain unaccepted. The helper name does not mean indefinite reporting. |
| Native Wi-Fi fence | `WIFIFENCE,1,<radio-1>,2,<radio-2>,3,<radio-3>` | Documented; full-form builder is preview-only | Shared V46/V48/V52 II.35 applies to V52 per operator confirmation. Example uses three entries; guide says two zones. This does not establish a three-router minimum. Unused slots and readback/removal are unspecified. Strict-admin capture records responses and fence bits without accepting them as Home. |
| One-router fence trial | `WIFIFENCE,1,<enrolled-radio>` | Experimental; first attempt inconclusive | 11 September 2026: one socket handoff, no `WIFIFENCE` reply or fence bits in a complete 30-minute capture. Both responses were `CR`; 13 fresh reports included one enrolled-router sighting. Not proof of acceptance or lack of support. Dedicated private CLI, strict admin and one attempt per process; not in `commands.js`, no SMS/padding/deletion/fallback. Setting may persist; readback/removal are unknown. Do not repeat the send after restart. See `services/wifi-home-supplier-validation.md`. |
| Voice monitor callback | `MONITOR,<phone>` | Documented | Confirm callback, audio, consent indication and carrier behaviour. |
| Ring/find watch | `FIND` | Documented | Confirm sound, duration and how it stops. Do not claim a 60-second auto-stop. |
| SOS alarm delivery mode | `MOD,<0..3>` | Documented; `MOD,0` platform-only behavior rejected on pilot firmware | Vendor descriptions: `0` platform only; `1` platform+SMS+call; `2` platform+call; `3` platform+SMS. On 24 August 2026, the exact V52 acknowledged `MOD,0` but still displayed **Calling...** and sent a carrier SMS. No completed call was observed, but the pilot SIM already blocks outbound calls. The watch acknowledged restoration to `MOD,1`. Mode `3` remains unverified. Do not promote another mode combination or claim screen-text control without supplier evidence and separate acceptance. |
| Fall detection | `FALLDOWN,<enabled>,<dial>` | Documented | Confirm watch setting and a controlled fall event. |
| Fall alert switch | `FON,<0\|1>` | Documented; now dispatched with fall preferences | Keep the separate fall-alert switch aligned with the detector. Confirm local alert behaviour and a real `AL_LTE` event on the exact firmware. |
| Fall sensitivity | `LSSET,<level>+6` | Documented | Confirm supported levels and real sensitivity effect. |
| Medication reminder | `TAKEPILLS,...` | Documented | Confirm once, daily and weekly execution on the real watch. |
| Reporting interval | `UPLOAD,<seconds>` | Documented | Confirm accepted range and battery impact before changing defaults. |
| Enable/disable pedometer | `PEDO,1|0` | Live-proven on one V52 for enable | `PEDO,1`, following the full-day sheet, changed the inactive Steps screen into a working counter. `PEDO,0` remains documented only. This configures counting; it does not upload a total. |
| Configure counting windows | `WALKTIME,...` | Live-proven on one V52 as part of enable sequence | The vendor example's full-day sheet plus `PEDO,1` activated counting. The time-sheet command's independent effect and alternate windows remain unproven. |
| Incoming-call allowlist contact | `PHBX,<serial>,<UTF-16BE name hex>,<phone>,<picture>` | Live-proven on one V52 | With picture empty, the entry appeared, persisted after reboot, allowed its approved number to ring the watch, and clear two-way audio followed answer; an unknown number was blocked. Guardian's SIM does not permit outbound calls. Repeat on a second watch and confirm replacement/removal before customer activation. |
| Request heart/BP pilot | `hrtstart,1` | Documented / supplier-guided | The mixed-family example labels this V46-only; supplier guidance states the V46 and V52 implementation is shared. Keep strict-admin and flag-disabled until the exact V52 returns `bphrt` and the watch display is recorded. |

## Care wellbeing uploads

| Upload | Evidence | Guardian handling | Remaining boundary |
|---|---|---|---|
| `bphrt,<systolic>,<diastolic>,<heart rate>,...` | Documented | Parse only the three confirmed leading values; persist only with durable wearer consent; no clinical classification. | Capture on the exact V52 and compare with the watch display. |
| `oxygen,<type>,<value>` | Documented | Validate a whole-number percentage, acknowledge `oxygen,1` when transport-valid or `oxygen,2` on invalid input, and retain the type without interpretation. | Capture wearer-initiated exact-V52 upload and compare with the watch display. |
| `bodytemp`, `bodytemp2` | Protocol p9 documents BT=2 cycle hours and single measurement | Configured private pilot only; current-session BT:2 required. Automatic starts additionally require accepted wearing evidence. | Verify single, 8h/12h cycles, stop and failure on the exact watch; see [routine evidence](testing/wellness-routines-2026-09-15.md). |
| `BTTIMESET` | Protocol p9 documents a distinct TM=1 timing mode | Remains blocked; never substitute it for BT=2 without firmware evidence. | Confirm exact firmware mode and payload/result contract. |
| `btemp2` | One `1,<two-decimal Celsius value>` upload matched the pilot's wrist display on 15 September | Configured-pilot, consent-gated private ingestion and saved-capture import; never customer-displayable. Existing bare ACK preserved, vendor ACK semantics unverified. | First field meaning, other/error variants, sensor reliability and temperature downlinks remain unverified. See the [capture/import runbook](testing/temperature-payload-pilot-2026-09-15.md). |

The V52 datasheet lists the sensors, but a sensor claim does not establish a command or upload schema. Customer display remains off until the separate real-device gate passes.

## Alarm decoding guardrail

The V52 alarm state is the eight-character hexadecimal field at argument index
15 of the full LTE layout. Production mappings are SOS bit 16, low battery 17,
safe-zone exit 18, entry 19, bracelet removal 20 and fall 22. The exact pilot
firmware has also emitted the adjacent bit 21 for fall; Guardian accepts both
fall variants while retaining the bit-20 removal mapping. Shortened older-model
layouts are still rejected by tests.

## V52 telemetry field use

The fixed V52 positioning layout is decoded without moving the tracker-state
field at index 15 or changing how the variable LTE/WiFi tail is scanned.

| V52 field | Guardian use | Product wording guardrail |
|---|---|---|
| Altitude/elevation (index 9) | Stored on the self-contained location observation and location history. | Context only; not a safety or floor-level claim. |
| Satellite count (index 10) | Stored with the GPS observation and shown as GPS context. | Satellite count does not prove a metre-level accuracy radius. |
| Cellular signal 0–100 (index 11) | Stored with an independent receipt timestamp and shown as the exact fresh percentage. | Never infer “Signal good” merely because the TCP session is connected. |
| Battery 0–100 (index 12) | Stored with an independent receipt timestamp and used by existing battery safety logic. | Missing or stale data remains unknown. |
| Steps (index 13) | Stored as `stepsRaw`; the disabled activity pipeline can aggregate it into protected local-day shadow records. | Do not call it “today's steps” until reset, reboot and midnight behaviour are proven and customer gates are enabled. |
| Roll count (index 14) | Stored as `rollCountRaw` for diagnostics. | Do not display or interpret it until vendor/real-device semantics are proven. |
| Tracker state (index 15) | V52 alarm bitmap only. | Must never be shifted or replaced by a tail value. |

The `LK,steps,rolls,battery` heartbeat updates the same raw counters and
battery field. Telemetry piggybacks on existing throttled device writes; it
does not add one Firestore history document per packet.

The activity pipeline consumes the same passive counter. `PEDO` and `WALKTIME`
are configuration commands, not step-total requests, and are never sent by
passive ingestion. The explicit strict-admin provisioning workflow exists for
new watches whose pedometer is inactive. Shadow aggregation and customer
display have independent, default-off gates.

Vendor documentation, automated tests and real-device acceptance are three
different forms of evidence. A capability becomes a Guardian product promise
only after all required real-device and notification checks pass.

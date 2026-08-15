# Guardian V52 command evidence

Guardian supports one production watch model: **ReachFar V52**. This ledger
prevents older-model syntax, generic examples and live V52 results from being
treated as interchangeable.

## Evidence levels

- **Proven:** observed successfully on Guardian's real V52.
- **Documented:** present in vendor V52/mixed-family protocol examples and
  regression-tested, but not yet accepted on the real V52.
- **Blocked:** intentionally not automated because the exact production value
  or safe behaviour is not established.

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
| Request location | `CR` | Proven | Real V52 returned GPS and Wi-Fi/LBS observations. |
| Voice monitor callback | `MONITOR,<phone>` | Documented | Confirm callback, audio, consent indication and carrier behaviour. |
| Ring/find watch | `FIND` | Documented | Confirm sound, duration and how it stops. Do not claim a 60-second auto-stop. |
| Fall detection | `FALLDOWN,<enabled>,<dial>` | Documented | Confirm watch setting and a controlled fall event. |
| Fall sensitivity | `LSSET,<level>+6` | Documented | Confirm supported levels and real sensitivity effect. |
| Medication reminder | `TAKEPILLS,...` | Documented | Confirm once, daily and weekly execution on the real watch. |
| Reporting interval | `UPLOAD,<seconds>` | Documented | Confirm accepted range and battery impact before changing defaults. |

## Alarm decoding guardrail

The V52 alarm state is the eight-character hexadecimal field at argument index
15 of the full LTE layout. Production mappings are SOS bit 16, low battery 17,
safe-zone exit 18, entry 19, bracelet removal 20 and fall 22. Bit 21 and
shortened older-model layouts are rejected by tests.

Vendor documentation, automated tests and real-device acceptance are three
different forms of evidence. A capability becomes a Guardian product promise
only after all required real-device and notification checks pass.

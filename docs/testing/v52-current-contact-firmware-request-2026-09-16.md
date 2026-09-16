# ReachFar V52: current-contact firmware request

Prepared 16 September 2026. Ready for the operator to send to ReachFar's
firmware team; **not sent**. This is a request for a supported interface,
not a claim that a compatible update exists.

## Request

We integrate the V52 directly with our TCP gateway. We need the dashboard to
show whether the watch is currently on the wrist, including after it is put
back on. Removal alerts work, but the received packets do not expose a usable
current-contact state on our unit.

The watch returns these two firmware labels, in this order:

```text
C403H_RFHZ_V52_EN_750_V1.3_2025.03.10_18.29.29
C403H_RFHZ_V52_EN_04R6_V1.3_2025.03.10_18.29.29
```

Your V46–V48–V52 Communication Protocol, page 13, identifies status bit 3 as
wearing. The companion Example, page 5, calls it unused. On this unit:

- Ordinary `UD_LTE` status is `00000000` both while worn and while off wrist.
- Removal produces `AL_LTE` with `00100000` (bit 20).
- A later zero-bit UD has arrived while the watch remained off wrist. Therefore
  alarm clearance cannot establish restoration.
- Complete on-wrist optical replies contain three populated bphrt readings
  followed by four empty fields, and oxygen with measurement type `0`.
  No contact-validity field has been identified in these responses.

**Please confirm the exact supported setting/query for continuous contact on
this build, or provide compatible firmware that reports the state.** Our
preferred integration is the already documented bit 3 in the normal V52
status field, keeping bit 20 as the separate removal alarm.

We need:

1. Defined on-wrist/off-wrist polarity and handling of unavailable or invalid
   sensor state. Confirm whether the sensor establishes skin contact or only
   light/obstruction, and whether charging affects the result.
2. A fresh state after startup/reconnection, updates when removed and refitted,
   and periodic confirmation while stationary. Our proposed pilot target is
   at least once per minute; please specify supported cadence and battery cost.
3. Exact configuration, applied-setting readback and rollback, with packet
   examples for worn, removed, refitted, charging and sensor failure. Detection
   should work independently of whether the watch sends removal SMS.
4. If an optical validity interface is the supported alternative, provide its
   field definitions, freshness/cached-value behaviour and no-contact failure
   result. A plausible numeric reading alone is insufficient.

There is also a repeatable transport issue: after the removal alarm, incoming
traffic stops and the connection closes approximately 154 seconds later. In the
latest capture the expected `[SG*<protocolId>*0002*AL]` was written locally
within 5 ms, with matching ID/length and no write error. The peer then ended
the connection; no gateway close was requested. The peer is our TCP tunnel,
so this does not identify the initiating component or prove watch receipt.
Please confirm ACK expectations and whether removal/SMS processing suspends
data or has a reconnect timer on this firmware.

## Guardian readiness and acceptance

The gateway and dashboard already support accepted bit-3 wearing evidence.
Forty focused decoder/ACK/wearing tests pass. Current firmware acceptance stays
unverified until changed hardware behaviour is demonstrated.

Accept the proposed interface only after fresh worn/off/refitted states are
distinguishable, including stationary wear, covered off-wrist placement,
charging and reconnection. Missing data must not become worn. Repeating the
existing alarm-only cycle does not satisfy this acceptance.

If no supported current-contact interface or compatible firmware is available,
this V52 build cannot meet automatic current-wearing detection from its present
uploads. A software estimate may be a separately agreed product, but must not
be presented as sensor-confirmed wearing.

Evidence: [repeat and cleanup](v52-removal-ack-capture-2026-09-16.md) and
[signal investigation](v52-positive-wearing-investigation-2026-09-16.md).

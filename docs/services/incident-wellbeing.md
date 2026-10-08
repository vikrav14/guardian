# Readings captured for SOS and fall alerts

The initial SOS/fall notification is independent of sensor collection. A
background worker requests fresh measurements and preserves the first usable
results under that alert's ID. Follow-ups use those saved values, never the
device's latest routine history.

Status, 8 October 2026: the pilot gateway already ran this collection feature
from its local release tree. Its approved `guardian_incident_update_v1` template
was delivered in the evening SOS test, with all measurements unavailable because
the old five-minute start deadline expired behind the camera. This branch brings
that existing integration into version control and corrects the deadline mismatch
and reporting-command coordination. Hardware acceptance of the changes remains
pending. See [the test timeline](../testing/incident-capture-timing-2026-10-08.md).

## Fixed deadlines and command ordering

- Only gateway-originated SOS/fall alerts receive collection markers. A new job
  must be admitted within 90 seconds of the event; downtime never replays old SOS.
- The photo has priority. An incident capture waits at most four minutes from
  authorization, capped by its existing incident deadline. The SOS connection
  readiness check can add time before that request. A command echo is not proof
  of camera execution, and timeout is not proof the camera stopped internally.
- New version-2 reading jobs have an immutable nine-minute result deadline from
  SOS/fall receipt. A fresh optical request may start before minute seven, after
  the photo job ends and camera/voice/measurement gates permit it. Its entire
  two-minute response window must fit.
- `hrtstart,1` requests the existing optical sequence. Uppercase `BODYTEMP2` is
  sent once only after usable heart/BP and oxygen results, and only if its full
  two-minute window fits before the same nine-minute deadline. The synchronous
  sender guard rechecks that budget after asynchronous consent and lease reads.
- If temperature cannot fit, preserve usable optical results and finish with
  `temperature_budget_exhausted`. Missing data stays unavailable.
- Existing jobs retain persisted deadlines across restarts, including version-1
  jobs with a five-minute admission limit. Completed/frozen jobs never reopen.
  Device reservations and durable dispatch claims prevent overlapping incident
  requests; uncertain writes are never automatically retried.
- A newly received SOS/fall can still send its urgent reporting override. An
  existing emergency lease does not let routine telemetry, reconnect reassertions,
  outings or cooldown settings bypass an active camera request. Deferred interval
  intent is recomputed after release. Protocol replies, calls, locating and stop
  commands retain their existing prompt paths.

Nine minutes bounds reading collection, not WhatsApp delivery. A photo that has
not begun, provider delivery or other follow-up processing can take longer. The
initial alert never waits for these optional results. A failed camera can still
be working inside the watch after its gateway lease expires; only live testing
can establish the effect on subsequent sensor commands.

## Evidence and access

Each distinct alert owns its own snapshot. First usable values retain request and
gateway receipt timestamps, and later uploads cannot replace them. Only results
from the original measurement session and bounded request window qualify. V52
does not return our request ID or a reliable measurement timestamp, so correlation
does not prove when a sensor measured the value or that the watch was worn.

Readings retain `correlationOnly: true`, `wearingConfirmed: false` and
`timeBasis: gateway_receipt_not_measurement_time`. Messages describe estimates and
receipt times; they do not diagnose conditions or pronounce the wearer safe.

Collection and delivery require current wearer consent and an active Family or
Care service. Health recipients also need current wellbeing and alert permissions,
an opted-in WhatsApp channel and a verified number matching the destination. A
legacy emergency contact alone does not authorize disclosure of readings.

Private snapshots expire after 24 hours. The gateway deletes expired copies while
running; consent revocation deletes incident copies alongside routine readings.
Direct client access to snapshots and reservations is denied. Delivered WhatsApp
messages cannot be recalled by that database cleanup.

Manual, Gentle and Balanced selections permit incident measurements. Possibly
running native routines, diagnostic quarantine, another measurement, camera/voice
contention, consent loss or session change prevent conflicting commands. The
current runtime supports only `WIFI_HOME_PILOT_IMEI`; others are unsupported.

## WhatsApp and activation

Both incident switches default to false:

- `INCIDENT_WELLBEING_ENABLED` starts collection for new watch SOS/fall alerts.
  Existing wellness routine, wellbeing request, ingestion and customer gates,
  service access and consent must also permit collection.
- `INCIDENT_WELLBEING_FOLLOWUP_APPROVED` uses the approved readings template.
  Existing incident-photo/follow-up rollout gates must also be enabled.

`guardian_incident_update_v1` adds heart rate, oxygen estimate, blood pressure
estimate and skin temperature estimate to the photo follow-up. Unavailable
metrics say "no fresh reading received". Recipients without health permission
retain the photo-only follow-up. The button opens the existing incident gallery.

This integration does not send a separate message when photo follow-ups are
disabled or another alert is grouped into an existing photo incident. Each
eligible alert still owns an independent reading snapshot.

From `gateway`, `npm run incident:templates -- --incident-readings --check` checks
the exact approval contract. `--preview` is also read-only; `--submit` submits a
missing template. These operations do not change gateway flags.

Before a fresh live test, verify the gateway is idle, preserve runtime gates and
ngrok, and have the wearer trigger SOS. Compare alert receipt, photo readiness,
capture handoff/expiry, optical and temperature handoffs/results and actual
provider delivery. Do not replay the old SOS or substitute historical readings.
Software tests do not establish camera response, sensor accuracy or delivery.

Rollback can disable the two incident switches; the original alert and photo
paths remain. A code rollback must preserve persisted deadlines and terminal jobs.

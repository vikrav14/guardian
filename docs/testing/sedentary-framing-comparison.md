# Sedentary framing comparison — 28 September 2026

> **29 September correction:** the later connected and isolated remote On
> trials did not reproduce Open / 20. A physical local-Save control established
> that Open / 20 persists, while saving Close / 20 returns to Close / 0. The
> latter is normal local Off display, not an Off failure. The historical reports
> below remain observations, not current proof of reliable remote control or
> retained interval 20 when disabled. See [current evidence](movement-reminder-app-trial.md).

The pilot's AnyTracking upper Save changed the watch menu from Close / 0 to
Open / 20. Its exact request was `[3G*9705254749*000e*SEDENTARY,1,20]` at
19:09:11.855 UTC, followed by bare SEDENTARY at 19:09:12.208. Guardian's prior
two enables and off each received a reply but left the menu at Close / 0;
Guardian emitted `[SG*9705254749*000E*SEDENTARY,1,20]` for enable. The request
payloads match. Only the prefix and hexadecimal length case differ. This does
not independently establish which difference matters or exclude session context.

At 23:21 Mauritius the operator confirmed Close. The supplied Guardian log
shows device identification, live-session writes, battery/heartbeat persistence
and ongoing presence through approximately 19:21 UTC after the comparison.
The cleanup method and final interval were not specified. Treat this as an
operator-reported closed menu and resumed Guardian traffic, not remote off proof.

## Temporary helper

`gateway/scripts/trial-sedentary-framing-preload.cjs` is an explicitly loaded
Node preload, not part of normal startup. It opens no listener, sends no command,
does not log credentials and does not alter authentication or configuration files.
Loading the existing protocol module also loads the gateway's usual configuration.
The existing authenticated `/dev/downlink` route and connected device session
still perform any send. It intercepts the frame builder before `server.js` imports
the downlink module. Only the chosen ten-digit protocol ID and the exact bodies
`SEDENTARY,1,20` / `SEDENTARY,0,20` use `3G` and lowercase `000e`.
Other devices, commands, intervals, replies and schedules retain their original
builder. In particular this does not fix or exercise SEDENTARYWORKTIME handling.

The helper validates the existing frame format before startup. One enable frame
can be built within twenty minutes of startup. A second attempt or expired
enable throws before a frame is returned; it never falls back to the old frame.
An attempted frame is consumed before socket handoff, so a failed/uncertain
write must not be retried. Off remains available for cleanup after the window.
`sedentary_trial_frame_built` is not proof of send or application. Use the actual
downlink log, watch reply and physical menu to assess the result.

Stop the current gateway first. From `gateway/`, set
`GUARDIAN_SEDENTARY_FRAME_TRIAL_PROTOCOL_ID=9705254749` in that process environment
and run `node --require <absolute-helper-path> src/server.js`. Leave ngrok running.
Require `sedentary_frame_trial_ready` and a fresh watch connection before one
authenticated on request. Expect the downlink log to show the captured 3G frame.
Reopen the watch menu without a local Save. Record exact output and physical state.
Then send off once through the same route and check the watch menu again. If
needed, close the setting locally and record that cleanup source separately.

This is a setting comparison, not the twenty-minute inactivity behavior test.
Do not resend the schedule, start other feature trials, infer wearer condition,
or promise reminder timing from this setting test. After cleanup, stop the trial
gateway, restore/remove the environment variable and restart normally with
`npm start`. A normal restart removes the helper but does not undo a setting
already applied on the watch. No runtime/customer feature is enabled by this PR.

The helper can be extracted from this PR's exact commit into a temporary folder
while staying on the photo branch. Do not merge/switch branches merely to run it.
No photo/WhatsApp configuration or template activation is part of this test.

Run offline checks with:
`node --test test/sedentary-framing-preload.test.js` from `gateway/`.
## Physical Guardian reproduction passed — reported 23:33 Mauritius

The operator started the helper against the existing photo gateway, which logged
`sedentary_frame_trial_ready` and a watch connection at 19:30:51.623 UTC.
Through the existing authenticated `Send-GuardianSedentary` helper:

| Action | Actual Guardian downlink | Operator-observed watch menu |
| --- | --- | --- |
| On | `[3G*9705254749*000e*SEDENTARY,1,20]` | **Open / 20** |
| Off | `[3G*9705254749*000e*SEDENTARY,0,20]` | **Close / 20** |

The gateway recorded one connected session for each send and a bare SEDENTARY
reply after each. The operator reported both physical menu transitions in the
same trial. The frame-built diagnostic's `commandSent:false` describes the
pre-handoff stage; the subsequent downlink and reply lines supply transport
evidence. The command lines lack individual timestamps, so do not infer exact
request times or response latency from adjacent telemetry.

**Accepted for this pilot:** the captured-format on/off requests change the
watch's displayed setting and retain interval 20. The earlier SG/000E requests
elicited replies without the desired menu change. The joint framing change
worked; prefix versus length-case causality was not separately tested. Do not
generalize to other firmware, intervals, commands or watches.

**Still unverified:** the audible/vibration reminder after inactivity, movement
reset/cadence, schedule enforcement and persistence across reboot. Off with a
closed menu is not an observed long-term suppression test. SEDENTARYWORKTIME
reply handling remains a separate implementation gap. Do not mark the whole
sedentary feature release-ready or enable customer controls.

Cleanup menu is confirmed **Close / 20** after the remote off. The next operational
step is to stop the temporary gateway and restart normally with `npm start`;
that normal restart has not yet been confirmed. The normal sender still uses its
existing framing: this successful test does not install a permanent fix.

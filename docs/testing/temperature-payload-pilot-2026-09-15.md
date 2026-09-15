# V52 temperature payload checkpoint — 15 September 2026

The operator completed a wrist-temperature measurement at 18:03:21 Mauritius
(14:03:21 UTC). The supplied photograph shows a numeric result. The gateway then
logged `unknown command: btemp2` between its 14:03:23 and 14:03:58 log entries.
The command name is observed evidence; its association with this measurement is
strong temporal evidence, not a verified numeric decoder. The photograph and
private value are not reproduced in this repository.

`btemp2` is distinct from the previously listed `bodytemp` / `bodytemp2` commands.
The current unknown-command event retains no arguments. Its existing bare ACK is
preserved, and this checkpoint does not establish the supplier's required ACK
format, a temperature request command, an automatic schedule or sensor accuracy.

## Capture the next wearer-initiated measurement

Pull the latest `feat/v52-care-wellbeing`. Keep the ngrok tunnel running. In the
gateway tab, stop `npm start` with Ctrl+C, then run:

```powershell
npm run temperature:capture
```

This starts the normal gateway with a ten-minute, ten-packet private capture for
the configured `WIFI_HOME_PILOT_IMEI` only. Wait for the watch to reconnect and the
`[temperature-capture]` armed line. Confirm `sessionConnected: true` with
`npm run wifi-home:check` in the checks tab. Take one wrist-temperature measurement;
note the watch value and local completion time.

When `packet_saved` appears, share the `.jsonl` file at its printed `savedTo` path
privately with the matching watch value/time. Numeric fields are not printed in
ordinary gateway logs. The file is created only after a qualifying packet and a
current backend-managed wellbeing consent check. Do not commit this private file;
`gateway/data/` is already ignored. Local captures are not synced to Firestore and
must be deleted locally when the comparison is finished.

The observer makes no additional watch requests or acknowledgements. Normal
gateway startup and existing services continue unchanged. Capture expires after
ten minutes while the gateway keeps running; ordinary `npm start` leaves capture
disabled. No customer flags, preview grants, alerts or measurement schedules are
changed. A missing capture file is not proof that the watch lacks temperature:
check connection, window, consent and the printed capture status first.

## Remaining work

- One captured `btemp2,1,<value>` packet now matches the operator's displayed
  wrist value in Celsius. Only this decimal variant is supported in private preview.
- Verify the leading field's meaning, the supplier's ACK contract and additional
  success/error variants. The preserved bare ACK is not newly vendor-validated.
- Verify repeated hardware behavior and reliability before customer acceptance.
- Keep temperature requests, schedules and customer display disabled.

The capture does not infer temperature from a plausible number, another metric's
trailing fields, online state or the photograph. It does not establish worn state.

## Display the saved capture and future uploads

After pulling the updated `feat/v52-care-wellbeing` branch, restart the gateway.
With `CARE_WELLBEING_INGEST_ENABLED=true`, future uploads for the configured
`WIFI_HOME_PILOT_IMEI` use the private temperature path even under ordinary
`npm start`. The ten-minute capture command remains useful for inspecting other
variants; it is not required for ongoing ingestion of the supported shape.

The saved capture is local and contains no identity. Import only the file produced
by the configured pilot watch, using its existing Admin SDK environment:

```powershell
npm run temperature:import -- --file="data/temperature-captures/YOUR_CAPTURE.jsonl"
npm run temperature:import -- --file="data/temperature-captures/YOUR_CAPTURE.jsonl" --apply
```

The first command previews packet count and original receipt times without database
writes or numeric output. `--apply` stores the captured packet under the configured
watch, subject to current consent, enabled ingestion and retention. Whole-file shape
validation precedes writes. Future/expired timestamps and unsupported variants are
rejected. Repeating an import deduplicates through the normal reading identity.
The import neither assigns a new measurement time nor claims wearing was proven.

Restart Flutter with `--dart-define=GUARDIAN_WELLNESS_PILOT=true`. Existing deployed
rules/indexes and the existing unexpired viewer grant are sufficient. If the grant
expired, `npm run wellness:preview -- --enable` creates a new authorized preview.
The Skin temperature tile shows today's latest valid private sample and receipt
age; older dates stay in the permitted history window. Errors, unavailable access,
and absent samples do not become a zero value. Customer mode remains unavailable.

`npm run wellness:check -- --include-reading-values` includes the private
`skin_temperature` metric for explicit comparison. Normal diagnostics redact values.
Delete the local capture once its comparison/import is complete.

## Software validation

The initial capture checkpoint passed 1,026 gateway tests. Capture checks cover opt-in and
pilot isolation, unparsed field preservation, existing ACK/event compatibility,
revoked/expired consent, capture expiry during a pending read, packet/size bounds,
private file creation and isolated read/write/logger failures. The hardware
variant comparison is recorded above. New parser/import tests cover strict decimal
shape, pilot isolation, forced private status even under general acceptance,
consent, timestamps, idempotency and redaction. App/rules tests cover private
access, receipt age, day boundaries, error clearing and temperature history.
All committed numeric fixtures are synthetic; the operator's health values remain
in the private conversation/capture.

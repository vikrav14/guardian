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

- Compare raw argument positions and units with the watch display; receipt time
  is not assumed to be measurement time.
- Verify the upload/ACK contract and malformed/error variants before ingestion.
- Add a narrowly validated decoder and consented private preview integration.
- Keep the skin-temperature tile unavailable until that numeric path is verified.

The capture does not infer temperature from a plausible number, another metric's
trailing fields, online state or the photograph. It does not establish worn state.

## Software validation

The combined gateway suite passes 1,026 tests. Capture checks cover opt-in and
pilot isolation, unparsed field preservation, existing ACK/event compatibility,
revoked/expired consent, capture expiry during a pending read, packet/size bounds,
private file creation and isolated read/write/logger failures. The hardware
payload comparison remains outstanding; fixtures are synthetic, not a proposed
temperature encoding.

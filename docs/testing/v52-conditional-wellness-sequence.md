# V52 conditional wellness sequence

This supervised pilot tests one practical rule: request heart/BP, wait for both
usable heart/BP and oxygen uploads, then request temperature once with the
tested uppercase `BODYTEMP2` command. If the prerequisite uploads are missing or
unusable, temperature is skipped. This is a result-availability filter, not an
automatic wearing detector or a claim of measurement accuracy.

The operator's `--worn` or `--removed` label records the test condition. It does
not promote that condition to device-confirmed wearing. Fresh receipt after a
request establishes timing correlation; the wire does not provide a request ID
or guarantee that a returned number is a newly acquired measurement.

## Run with the existing gateway

Pull the current combined branch from the repository root:

```powershell
cd C:\Users\MSI\repos\guardian
git pull --ff-only
```

In the running gateway terminal, stop the old process with Ctrl+C and start the
updated gateway. Keep ngrok running; do not launch a second gateway or a separate
capture process.

```powershell
cd C:\Users\MSI\repos\guardian\gateway
npm start
```

Use a second PowerShell terminal in the gateway folder for the test. The existing
pilot configuration, Admin API key and current wearer consent are required.
First check connectivity without sending any watch request:

```powershell
npm run wellness:sequence
```

With the watch fastened on the wrist and connected:

```powershell
npm run wellness:sequence -- --once --worn --include-values
```

Keep it in that position until the attempt finishes. Do not press measurement
buttons on the watch or run another request during the attempt. The CLI waits up
to approximately four minutes: up to two minutes for the optical uploads, then
up to two minutes for temperature. It sends exactly one HTTP POST and polls only
the matching attempt. The backend controls the single conditional temperature
request; the CLI cannot select an arbitrary command or create a native schedule.

For a separate off-wrist control, wait for the preceding attempt to finish and
for its displayed `sequence.cooldownUntil` time to pass. A result can arrive
before that reserved capture window ends. Remove the watch and leave its sensor
facing upward and uncovered:

```powershell
npm run wellness:sequence -- --once --removed --include-values
```

Sensor-up, uncovered storage is the recommended handling condition. Preserve the
earlier observation that contact with a tabletop produced plausible off-wrist
values: the storage instruction reduces that particular exposure but does not
make successful values proof that a person is wearing the watch. An off-wrist
attempt that passes the optical filter remains a counterexample, even if
temperature is then requested exactly as the software rule specifies.

Only temperature uses the existing off-wrist trial quarantine. Optical uploads
retain their existing ingestion path; this command does not quarantine the
entire attempt or remove its heart/BP and oxygen uploads from existing history.

## Interpret and recover

- `temperature_upload_observed`: both prerequisite uploads passed the filter and
  a temperature upload was observed after its request. Check values and times;
  this does not verify wearing, freshness or medical accuracy.
- `temperature_skipped`: inspect the sequence reason. Missing, zero or otherwise
  unusable prerequisite output is not itself proof that the watch is off-wrist.
- A disconnect, changed session, consent failure, timeout or uncertain handoff
  must not become a successful reading or cause an automatic retry.
- If the CLI is interrupted, cannot read status or reports an unknown handoff,
  do not repeat `--once`. The gateway may still be processing the first request.
  Retrieve its current state with the read-only command:

```powershell
npm run wellness:sequence -- --include-values
```

Omit `--include-values` when only metadata is needed. Do not commit private
diagnostic output. A gateway restart loses the in-memory attempt; it is not a
reason to infer that an earlier request was never sent.

The sequence does not reconfigure existing native schedules, removal alarms,
customer acceptance flags, or preview access. Avoid concurrent native/manual
measurements during this comparison; they can make timing correlation ambiguous.
If the Wellness preview has expired, renew that separate viewing grant with
`npm run wellness:preview -- --enable` using the existing authorized account.

Record the operator condition, attempt outcome, skipped reason, returned packet
times and any competing measurement activity. Automated CLI tests cover argument
validation, private values, one mutation, matching attempts, bounded waiting,
unknown handoff and read-only recovery. Hardware results remain a separate check.

# Photo FTP receiver and Firebase pilot

Status: standalone diagnostic prepared in PR #113. No watch FTP configuration
has been changed. Remote-only capture, public FTP connectivity from the watch,
and live Firebase import/delete have not passed physical acceptance.

The supplier's sections 37–39 describe `PIC,1`, `FTPIP` and `FTPPWD`. They are
a separate candidate from the captured `rcapture` / TCP `img` path. The
controlled 22:23 MUT `rcapture` test returned a bare reply but no image in the
supplied window. The decoded 21:39:27 MUT sample was manually taken on the
watch. Neither result proves `rcapture` needs FTP.

## Where Firebase fits

| Component | Role in this trial |
| --- | --- |
| Standalone FTP receiver | Accept a file using the watch's documented transfer protocol, then fully decode and validate it |
| Firebase Storage | Hold the validated JPEG in a private object |
| Firestore | Record identity, receipt time, digest, dimensions and import/deletion state |
| Existing Guardian gateway | Continue normal telemetry; these tools are not imported into startup |

Storage does not turn the watch's FTP protocol into an upload by itself. This
receiver bridges that transport; the operator import remains a separate step.
It creates no customer snapshot request and enables no app gallery.

## 1. First run: local readiness only

Run this in PowerShell. It creates a detached tools checkout without switching
the running gateway's branch. Python 3.10+ with the Windows `py` launcher is
required. Pinned diagnostic dependencies install in a dedicated environment
under `%LOCALAPPDATA%\Guardian\photo-ftp-python`.

```powershell
cd C:\Users\MSI\repos\guardian
git fetch origin feat/v52-remote-photo
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
$guardianPhotoTools = Join-Path $env:TEMP ('guardian-photo-ftp-tools-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
git worktree add --detach $guardianPhotoTools origin/feat/v52-remote-photo
if ($LASTEXITCODE -ne 0) { throw 'Tools checkout failed.' }
& (Join-Path $guardianPhotoTools 'gateway\scripts\prepare-photo-ftp.ps1') `
    -Mode Check -GuardianGateway 'C:\Users\MSI\repos\guardian\gateway'
```

Expected results: `ftp_self_test_passed`, the current ngrok endpoint table,
then `firebase_read_check_passed`. The latter checks linked-user access plus
bucket metadata/IAM readability; it does **not** prove upload permissions.
No watch commands, IP SMS, endpoint mutations or Firebase writes occur.

The Firebase check uses `firebase-admin` and `dotenv` already installed in the
running gateway and its `.env`. It requires `FIREBASE_PROJECT_ID` and
`GOOGLE_APPLICATION_CREDENTIALS` for a matching service account. It defaults
to `<project>.firebasestorage.app`; the Node tool also accepts the project's
legacy `<project>.appspot.com` bucket explicitly. Never paste the service-account
file or FTP session credentials into logs or PR comments.

If more than one user is linked to the watch, re-run the same check with
`-UserId` set to the intended linked Firebase user UID. Do not select an
arbitrary matching account. A failed cloud check does not invalidate a passed
local FTP transfer test, and should not be fixed by making the bucket public.

## 2. Public receiver readiness

FTP needs separate command and passive-data connections:

| Public TCP endpoint | Local upstream |
| --- | --- |
| FTP control | `127.0.0.1:2121` |
| FTP passive data | `127.0.0.1:2122` |

The last supplied account session allowed three endpoints. Guardian TCP plus
WhatsApp HTTPS leaves only one spare slot. Keeping Guardian while running both
FTP endpoints would require releasing the recorder endpoint **and temporarily
pausing the WhatsApp endpoint**, or using a different host/plan. No tool here
does that automatically. Choose the arrangement after the readiness result;
do not accidentally interrupt the alert tests.

Read actual endpoint URLs for every run. Both FTP endpoints must be reachable;
control-port reachability alone is insufficient. The server binds locally and
advertises the translated public passive port. PASV uses the resolved IPv4 of
the data hostname. EPSV is allowed only when both public hostnames match;
watch support for these modes is still unknown.

With two prepared endpoints, set `$guardianFtpControlUrl` and
`$guardianFtpDataUrl` to their actual `tcp://host:port` values, then run:

```powershell
& (Join-Path $guardianPhotoTools 'gateway\scripts\prepare-photo-ftp.ps1') `
    -Mode Serve -ControlUrl $guardianFtpControlUrl -DataUrl $guardianFtpDataUrl
```

The server prints `PRIVATE SESSION FILE` and `ftp_listening`. Leave that
window running. In another window, set `$guardianPhotoSession` to that printed
absolute path and run the probe with the same tools path and control URL:

```powershell
& (Join-Path $guardianPhotoTools 'gateway\scripts\prepare-photo-ftp.ps1') `
    -Mode Probe -SessionFile $guardianPhotoSession -ControlUrl $guardianFtpControlUrl
```

`ftp_probe_passed` proves a random 1,024-byte transfer through both public
connections to this local receiver. It does not prove watch reachability. The
probe removes its own file and sends no command to the watch.

## 3. Watch trial prerequisites

Use one operator-authorized tabletop capture. Before changing saved FTP
settings, establish the actual previous FTP destination/login and a supported
way to restore them. The supplied excerpt has no readback/reset command; do
not invent one or reuse its example IP, username or password. Returning the
watch's ordinary `ip,...#` route does not restore FTP settings.

Only after receiver readiness and restoration are resolved should an explicit
trial configure the real receiver with `FTPIP` / `FTPPWD`, then request the
documented `PIC,1`. These tools deliberately contain no sender. Preserve the
documented `CS` versus `SG` framing distinction; the manual's `FTPPWD` request
and `FTPSWD` reply spelling discrepancy is unresolved. A command acknowledgement
or filename reply is not an actual photo.

The receiver uses a new random, write-only FTP account for each run, accepts
only the selected IMEI/protocol-ID timestamp filenames, refuses overwrites,
and stops after 15 minutes. It accepts at most four validated JPEGs, 12 store
attempts, 512 KiB per file and 1,024 pixels per dimension. Plain FTP is an
unencrypted diagnostic transport: these short-lived credentials are never
Firebase credentials. Filenames/account access are not cryptographic proof
of watch identity or of a particular request causing the image.

Wait for `ftp_photo_validated` and its `receiptFile`. FTP transfer completion
can be sent before application validation, so FTP `226` alone is insufficient.
Invalid or incomplete images are removed. Normal events contain no photo
bytes or credentials. The local directory contains sensitive photos and
`session.json`; keep it within the user's private profile. Windows ACLs are
inherited from that profile; POSIX mode bits are not a Windows ACL guarantee.

Stopping/expiry neither restores watch settings nor changes ngrok. A restart
uses a fresh session directory; do not delete a prior capture to reuse it.

## 4. Private Firebase import and cleanup

Use the `receiptFile` from the validated transfer as `$guardianPhotoReceipt`.
Keep `$guardianPhotoUid` set to the intended linked user UID. First preview:

```powershell
$guardianPhotoPython = Join-Path $env:LOCALAPPDATA 'Guardian\photo-ftp-python\Scripts\python.exe'
$guardianPhotoImporter = Join-Path $guardianPhotoTools 'gateway\scripts\photo-trial-firebase.js'
node $guardianPhotoImporter --action import `
    --project-dir 'C:\Users\MSI\repos\guardian\gateway' `
    --receipt $guardianPhotoReceipt --python $guardianPhotoPython `
    --uid $guardianPhotoUid --consent
```

This fully decodes the JPEG again and checks its digest against the receipt.
Adding `--write` to the same command explicitly imports it. `--consent` records
operator confirmation for this test photo; it is not a customer authorization
or an override of the production safety-snapshot policy.

Successful import returns `photo_stored` and `importId`. The object lives at
`privatePhotoTrials/{imei}/{importId}.jpg`; metadata lives in
`photoTrialImports/{importId}`. Existing unmatched-path rules deny customer
access. Admin SDK access is privileged, so the tool verifies linkage and
checks bucket-level public IAM bindings, uses a private object ACL when
applicable, creates no download token/URL, and refuses object overwrites.
Inherited project IAM still applies; this is not a full project IAM audit.

The record always says `remoteCaptureVerified=false`,
`requestCorrelationVerified=false`, `customerVisible=false`, and
`automaticExpiry=false`. Production retention/viewing gates remain pending.
This diagnostic needs explicit cleanup; it does not implement the production
policy model's 24-hour expiry.

Set `$guardianPhotoImportId` to the returned ID. Preview deletion, then repeat
with `--write`:

```powershell
node $guardianPhotoImporter --action delete `
    --project-dir 'C:\Users\MSI\repos\guardian\gateway' `
    --uid $guardianPhotoUid --import-id $guardianPhotoImportId
```

Deletion verifies stored object identity and uses a generation precondition.
It removes the live object and retains an audit record marked `deleted`.
Bucket soft-delete/versioning policies can retain provider-managed copies;
this is not a guaranteed immediate hard purge. The local JPEG, receipt and
session directory require separate operator cleanup after evidence is kept.
If an import reports `cleanup_required`, inspect that record and use the
same deletion tool; do not claim the upload was rolled back.

## Verification at this checkpoint

43 focused Node tests passed: 33 existing recorder/decoder tests, eight
Firebase-adapter tests, and two explicit Python-backed acceptance tests.
Real local transfers run through distinct TCP control/data proxies; the
Firebase adapter uses fakes, not the live project. Full JPEG decoding and
tampered-receipt rejection were executed. Ordinary `npm test` does not need
Python; the explicit check is `gateway/acceptance/photo-ftp.check.cjs` with
`GUARDIAN_PHOTO_PYTHON` configured. PowerShell execution, actual ngrok forwarding,
live Firebase writes/deletion, watch FTP compatibility and remote capture
remain to be tested. No full release CI or customer-readiness claim is made.

References: [Firebase Admin Storage](https://firebase.google.com/docs/storage/admin/start),
[pyftpdlib API](https://pyftpdlib.readthedocs.io/en/latest/api.html), and the
supplied V52 protocol sections 37–39. See also
[the TCP photo evidence](photo-reference-capture.md).

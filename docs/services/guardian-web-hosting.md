# Guardian web app on Firebase Hosting

The existing Flutter app can be published to the default Hosting site in project
`guardian-fbadd`. The console currently has no live Hosting release. After a
successful deployment the app address is `https://guardian-fbadd.web.app`.
Do not consider that address ready until the deployment and sign-in checks pass.

Photos remain in private Firebase Storage. Hosting serves only the compiled app
and its public browser configuration. Incident URLs use `/?incident=ALERT_ID`;
the app keeps the incident ID through email/password sign-in, and the gateway
still verifies the current account's access before returning photos or AI text.
The link itself does not authorize access. No Firestore or Storage rule changes
are part of this deployment.

## Publish from the working Windows checkout

Keep the gateway and the HTTPS ngrok endpoint to port 9001 running. Use the same
checkout that successfully runs Flutter and contains `apps/mobile/web/maps_key.js`.

```powershell
Set-Location C:\Users\MSI\repos\guardian
git pull --ff-only origin feat/v52-remote-photo
if ($LASTEXITCODE -ne 0) { throw 'Update failed. Stop here.' }
& .\scripts\deploy-guardian-web.ps1
```

The script discovers the current ngrok HTTPS endpoint, checks `/health`, signs in
to the Firebase CLI if needed, builds the app with that gateway URL, and runs
`firebase deploy --only hosting --project guardian-fbadd`. It uses a pinned
Firebase CLI package via npx; no global CLI installation or stored CI credential
is needed. Native command failures stop before deployment. The published release
marker must match the fresh build before the script reports success.

To supply a stable gateway explicitly, use `-GatewayUrl https://YOUR-GATEWAY`.
The manual safety snapshot dashboard button remains disabled by default, matching
the ordinary Flutter launch. Add `-EnableSafetySnapshots` only when deliberately
publishing that UI; server consent and device eligibility checks still apply.
Incident galleries do not require that manual-capture UI flag.

The browser Maps key is copied from the working local app and never printed or
committed. If its current HTTP referrer restrictions only allow localhost, add
`https://guardian-fbadd.web.app/*` and, if used,
`https://guardian-fbadd.firebaseapp.com/*` to that same key's permitted referrers.
Do not remove the key's restrictions. Firebase Authentication must also accept
the app's domain; the project's default Firebase domains are normally present.

## Verify before enabling WhatsApp photo delivery

1. Open the published address on a phone. Confirm Guardian's login page loads.
2. Open `/?incident=RECENT_TRIAL_ALERT_ID` while signed out, then sign in with
   the existing authorized Guardian account. Confirm that the incident opens,
   original photos and AI details load, and rotation controls work.
3. Use an existing unauthorized test account to check that the same link does
   not disclose photos. Do not create family access merely for this check.
4. Confirm Maps works. If it reports a referrer restriction, update only the
   existing Maps key's permitted app domains as described above.
5. Submit `guardian_incident_photo_update_v1` with the verified gallery base
   `https://guardian-fbadd.web.app/?incident={{1}}`, wait for approval, then follow
   the v3 rollout checks in `incident-photo-whatsapp-v3.md`.

This step does not host the Node gateway. While using the development gateway,
the PC, gateway process and ngrok tunnel must remain running. If the gateway URL
changes, rebuild and redeploy with the script; the app's public URL stays the same.
Moving the gateway to persistent hosting is a separate release.

## Rollback

After the first release, Firebase Hosting's release history supports rollback to
a previous app release. Reverting hosting does not revert the gateway, database,
photos, consent, or WhatsApp template activation. Do not run an unrestricted
`firebase deploy` for this task; use the hosting-only script.

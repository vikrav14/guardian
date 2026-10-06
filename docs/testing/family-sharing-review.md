# Try Family sharing locally

This review runs the actual Flutter application and family API against Firebase
Auth, Firestore and Storage emulators. No production credentials are used. The
fixed project is `demo-guardian-family`; every service binds to `127.0.0.1`.
The real watch gateway, hosted app, billing and customer data are not involved.

## Start on Windows

Install the repository's Flutter dependencies and run `npm ci` in `gateway` and
`firestore`. Java 21+ and Node are required. Use the existing local
`apps/mobile/web/maps_key.js` for Maps; keep it out of Git.

From this checkout run:

```powershell
./scripts/start-family-review.ps1
```

Open <http://127.0.0.1:9080>. The launcher builds into `build/family-review`,
separate from the production web output, then starts hidden background processes.
Use `-SkipBuild` to restart a previously built review. An existing healthy review
is reused; unrelated occupied ports cause startup to stop instead of being killed.
Logs and process IDs are in the ignored `.guardian-review` directory.

## Try the flow

1. Choose **Vikesh · owner**. Amira is the Family sample (Rs1,000, three people,
   two selected WhatsApp safety recipients, 50 shared ordinary answers/month).
   Marcel is the Care sample (Rs1,300, five people, three recipients, 100 answers).
2. In **Family → People**, invite `neelam@guardian.test`. Choose a role, review
   the permission switches and copy the personal code. Ravi already occupies a
   Viewer place on Amira's circle; pending invitations count towards the limit.
3. Use the account menu in the green **GUARDIAN TEST** banner to switch to Neelam.
   Choose **Accept invitation** and paste the code. Switch back to Vikesh to
   adjust her permissions or remove access; switch again to check the result.
4. Open the header bell and the sample SOS. **I'm responding** records the named
   responder. Resolving the incident is a separate action.
5. In **Family → WhatsApp**, generate a link code. From the green test banner's
   account menu, choose **Simulate WhatsApp message** and paste the whole `LINK`
   message. Close the simulator and refresh Family. Enable recipient consent;
   as the owner, choose the safety recipients within the plan cap.
6. In the simulator try `999991 battery` or `999991 where`. This uses Amira's
   allowance. `ACK review-sos` uses the same explicit response handler without
   spending an ordinary answer. All phone numbers and outgoing replies are
   synthetic; the simulator never sends an actual WhatsApp message.

Test users are `vikesh@guardian.test`, `neelam@guardian.test` and
`ravi@guardian.test`. The review-only password is `Guardian-review-2026!`;
the picker signs in for you. These identities exist only in the emulator.

The initial seed is idempotent. Restarting just the API preserves emulator state;
stopping the emulators clears this disposable test data. Other hardware-dependent
features may report unavailable because the review has no connected watch or
production gateway. Only sample positions are displayed. Email verification is
seeded for test users; real invitations still require a verified account email.

## Phone browser over USB

With an authorized Android phone connected and USB debugging enabled, forward
the five review ports:

```powershell
foreach ($port in @(9080, 9011, 8185, 9195, 9295)) {
  adb reverse "tcp:$port" "tcp:$port"
}
adb shell am start -a android.intent.action.VIEW -d http://127.0.0.1:9080
```

The phone must remain connected to this laptop. This opens the test web app;
it does not replace the installed Guardian app or test native push delivery.

## Deployment boundary

The review entry point is `tool/family_review_main.dart`; the normal entry point
continues to use the production AuthGate. The review server refuses to start
unless the exact demo project and all fixed local emulator addresses are set.
The WhatsApp provider adapter is replaced only in this standalone review server.

Before a live rollout, finish real handset/provider acceptance, the approved
WhatsApp response button, billing/provisioning integration and reviewed migration
of existing safety contacts. Merging the PR alone does not perform these steps.

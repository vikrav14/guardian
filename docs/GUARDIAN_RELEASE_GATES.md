# Guardian pull-request release gates

**Status:** Required engineering release contract

## Purpose

Every pull request into `main` must prove that Guardian's gateway, Flutter app,
Web build and Firestore authorization boundaries remain valid. A locally green
run is useful evidence, but it is not a shared merge control. The workflow in
`.github/workflows/guardian-release-gates.yml` makes the same core evidence
visible on the pull request.

The workflow performs validation only. It does not deploy Firebase resources,
send WhatsApp messages, start the production gateway, access production
credentials or write customer data.

## Automated jobs

| Required check | Evidence |
| --- | --- |
| `Gateway tests` | Installs `gateway/package-lock.json` with `npm ci` and runs the complete Node test suite. |
| `Flutter analyze, test and Web build` | Uses Flutter 3.44.6, restores the committed lockfile, analyzes the app, runs all Flutter tests and creates a release Web build. |
| `Firestore authorization` | Uses Node 22 and Java 21, starts the local Firestore emulator and runs the authorization test suite. |

Each job is independent so a failure identifies the affected boundary quickly.
Superseded runs are cancelled when a new commit is pushed to the same pull
request.

## Security and cost controls

- Workflow permissions are read-only (`contents: read`).
- Checkout credentials are not retained.
- Official GitHub setup actions are pinned to immutable commit SHAs.
- Flutter is installed from the official Flutter repository at the immutable
  commit for version 3.44.6.
- No Guardian, Firebase, Anthropic, Meta or Google production secret is used.
- No production deployment occurs.
- GitHub-hosted runner usage is bounded with explicit job timeouts.

## Local equivalents

Run these commands before pushing when practical:

```powershell
cd "C:\Users\MSI\repos\guardian\gateway"
npm ci
npm test

cd "C:\Users\MSI\repos\guardian\apps\mobile"
flutter pub get --enforce-lockfile
flutter analyze
flutter test
flutter build web --release

cd "C:\Users\MSI\repos\guardian\firestore"
npm ci
npm test
```

## Main-branch merge policy

After this workflow has completed successfully at least once, configure the
`main` branch ruleset to:

1. require a pull request before merging;
2. require all three checks listed above;
3. require the branch to be up to date before merging;
4. block merging while any required check is pending or failing.

Keep PR #106 in draft until the advertised-promise audit and real V52 device
acceptance gates are also complete. Passing CI proves repository consistency;
it does not by itself prove every Guardian product promise.

## Real V52 evidence gate

Run the controlled procedure in `GUARDIAN_V52_REAL_DEVICE_ACCEPTANCE.md`. The
read-only backend collector is:

```text
cd gateway
node scripts/inspect-device-acceptance.js --imei <IMEI> --since <UTC-or-duration>
```

The report distinguishes backend-observable evidence from manual carrier/watch
evidence. It deliberately leaves `releaseReady` false: a green collector cannot
waive the remaining gates, and TCP dispatch is never treated as a wearer
acknowledgement.

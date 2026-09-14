# Private Wellness screen pilot

The operator requested that the recorded step totals and received heart/BP/oxygen
readings appear in the app following the 14–15 September field tests. This adds
an explicit diagnostic viewing permission, separate from customer acceptance.
The permission is for one linked account and one watch and lasts at most 24 hours.
It is not evidence of sensor accuracy, confirmed wearing, or unattended reliability.

## What appears

- Home shows today's `recordedSteps`, marked Partial day, and today's received
  heart-rate and oxygen readings with their original receipt times.
- Family/Care View wellness includes dated activity and heart/BP/oxygen history
  within the existing edition windows. Essential remains today-only.
- The screen visibly identifies private, unverified readings and unconfirmed
  wearing at measurement time. It has no AI/report action for preview data.
- Yesterday's measurements never populate today's card. A new measurement is
  required to populate today's heart/oxygen tiles; older readings stay in history.
- Skin temperature remains `— °C · Not available yet`. The operator previously
  saw temperature on the watch, but no exact V52 temperature upload shape has
  been verified. No value is copied from chat, inferred from another metric or
  generated from the unsupported `bodytemp`/`bodytemp2` responses.

## Authorization and source integrity

Normal `displayable` queries and customer qualification are unchanged. A new
server-owned `wellnessPilots/{imei}` document grants only its `viewerUid` access
to diagnostic activityDays/wellbeingReadings within the active edition window.
Clients cannot create, extend or transfer that grant. Linked membership, trusted
subscription and current wellbeing consent are still enforced in Firestore.
Health consent is checked again on every authorized read; preview creation does
not grant consent. Private tracker diagnostics and counter baselines remain private.

The UI requires `GUARDIAN_WELLNESS_PILOT=true` and a valid server grant. Sign-out,
unlink, grant revocation and expiry remove private data. The history route has
its own access boundary; a grant expiry also clears an already-open route.
Source records retain `displayable: false`, their quality and wearing metadata.
No existing raw count is rewritten as wearing-qualified. Backend/WhatsApp/AI
consumers keep their existing customer restrictions.

## Run on the pilot computer

From the repository root, pull the combined `feat/v52-care-wellbeing` branch and
deploy its authorization rules and query indexes using the existing Firebase login:

```powershell
git fetch origin
git switch feat/v52-care-wellbeing
git pull --ff-only
firebase deploy --only "firestore:rules,firestore:indexes" --project guardian-fbadd
cd gateway
npm run wellness:preview -- --enable
```

The command uses WIFI_HOME_PILOT_IMEI and the existing Admin SDK credentials. If
exactly one account is linked, it selects that account. If there are multiple,
it requires an explicit selection rather than granting every family member access:

```powershell
npm run wellness:preview -- --enable --viewer-email=YOUR_APP_LOGIN_EMAIL
```

Restart the Flutter app from apps/mobile with the preview flag, retaining any
other existing platform or map configuration needed for the user's local build:

```powershell
flutter run -d chrome --dart-define=GUARDIAN_WELLNESS_PILOT=true
```

The preview flag alone shows the card; the customer flags may stay false. No
gateway restart or new watch configuration is required for this viewing change.
The grant command prints expiry and outcome without health values or identifiers.
An index may need time to build; do not treat query preparation as absent readings.
If loading fails after deployment, retain the Firebase error code from the browser
console to distinguish permission errors, missing indexes and network errors.

To stop access immediately:

```powershell
npm run wellness:preview -- --disable
```

This PR does not activate measurement schedules, send watch commands, publish
weekly reports, deliver alerts or enable customer/device acceptance flags.
Temperature capture and interpretation remain a separate device-dependent step.

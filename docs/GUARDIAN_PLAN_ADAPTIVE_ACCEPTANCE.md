# Guardian plan-adaptive acceptance checklist

**Baseline:** `65ea35cd72bec9580f09ecfeb29dbaf6a7912b6a`
**Plans:** Guardian Essential, Guardian Family, Guardian Care
**Rule:** A hidden control is not authorization. Flutter, service code, Firestore rules and gateway execution must agree.

## Automated gate

- Gateway full test suite passes.
- Flutter analyzer and full test suite pass.
- Flutter Web release build passes.
- Firestore emulator authorization suite passes on Java 21.
- `git diff --check` reports no errors.
- No Firestore deployment or Git commit is performed by the package installer.

## Essential acceptance

- Account shows Guardian Essential and `0 of 1 caregiver used` for a new owner.
- Dashboard shows factual **Watch status**, not Guardian AI branding.
- **Ask Guardian** is visibly locked and explains that Family or Care is required.
- Dashboard does not show wellbeing summaries or medication support as active.
- Journey calendar cannot select a day earlier than the last seven calendar days.
- A direct attempt to read a location, segment or journey record older than seven rolling days is denied by Firestore.
- First verified caregiver can join; a second concurrent acceptance is rejected.
- Essential does not present WhatsApp questions/answers or WhatsApp safety alerts as included.

## Family acceptance

- Account shows Guardian Family and a five-caregiver limit.
- Dashboard shows Guardian AI and the WhatsApp action.
- Dashboard and settings do not present medication or Care wellbeing controls as active.
- Retained journey dates older than seven days can be selected and read.
- A Family client cannot create, toggle or delete medication reminders, including by direct Firestore SDK calls.
- Up to five unique caregivers can join; the sixth is rejected transactionally.

## Care acceptance

- Account shows Guardian Care and a five-caregiver limit.
- Family capabilities remain available.
- Care profile, wellbeing/routine sections and medication reminders are available.
- Creating a medication reminder writes the Care record and queues the matching watch command exactly once.
- Family and Essential downgrades immediately lock Care controls and direct writes.
- No Care panel claims a medication reminder is enabled unless a real reminder record exists.

## Two-account family acceptance

Use two distinct Firebase Auth accounts in separate browser profiles.

1. Sign in as the plan owner and create an invite.
2. Sign in as the second account and submit the six-character code.
3. Confirm the second account sees a pending join request, without inherited watches or plan access yet.
4. Let the gateway process the request.
5. Confirm the request becomes accepted, the second account inherits the owner's watches and effective plan, and both accounts show the same caregiver usage.
6. Confirm the family member cannot create invitations; only the owner can.
7. Remove/revoke the member through the trusted backend lifecycle and confirm inherited plan, watch access and private data disappear.
8. Repeat at the Essential and Family/Care capacity boundaries, including two simultaneous final-slot requests.

## Production rule deployment gate

Deploy `firestore/rules.example` only after the emulator suite is green and the diff has been reviewed. After deployment, repeat one recent-history read, one denied Essential old-history read, one denied Family medication write and one allowed Care medication write against non-production test accounts.

## Evidence to retain

- Test command output and commit SHA.
- Screenshots for each plan dashboard, Account page and Care settings.
- Firestore emulator results.
- Join request and transaction outcome IDs with personal data redacted.
- V52 command/delivery receipts for device-dependent tests.
- Any mismatch as a blocking issue linked from draft PR #106.

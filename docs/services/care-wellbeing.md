# Wellness watch readings

Wellness is a normal app surface on `main`. The dashboard card is visible for
every active edition through the activity entitlement, without a Flutter
launch flag or expiring viewer grant.

| Property | Contract |
|---|---|
| Service ID | `care-wellbeing` |
| Activity minimum plan | Essential |
| Watch-reading minimum plan | Family |
| Lifecycle | `customer_estimate` |
| Customer wording | Watch estimates; not medical measurements |
| Wearing claim | None. A successful upload does not confirm the watch is worn. |
| Consent | Backend-owned wearer consent is required before persistence and Family/Care reads. |

The app shows recorded activity and supported watch readings with their own
receipt times. Missing, stale, malformed and unavailable values remain explicit.
Activity totals are partial observed deltas when coverage is incomplete. Optical
and temperature values retain transport/device quality, but quality is not a
medical classification.

## Supported protocol surface

- `bphrt` — heart rate and blood pressure upload.
- `oxygen` — blood oxygen upload.
- `btemp2,1,<two-decimal Celsius value>` — the one supported temperature upload
  shape observed on the V52. The prefix is preserved as an opaque source variant;
  it does not establish wearing, measurement success or clinical accuracy.
- `hrtstart,300..65535` — documented scheduled optical interval range.
- `hrtstart,0` — explicit stop.
- `bodytemp2` and `bodytemp,0/1,1..12` remain supplier-documented command forms,
  subject to the separate exact-watch operational checks.

Other metrics, prefixes, encodings and sentinel/error shapes are rejected rather
than guessed. `BTTIMESET` remains blocked until its behavior is captured.

## Access and operational controls

Customer access is determined by the linked user, active subscription/edition,
Family entitlement for basic readings, history window and current consent. It does not
depend on `wellnessPilots/{imei}`, an IMEI-specific viewer grant or a Flutter
`--dart-define`.

The gateway still has independent operational switches so deployment can be
staged safely:

```dotenv
CARE_WELLBEING_INGEST_ENABLED=false
CARE_WELLBEING_DEVICE_MODE=unverified
CARE_WELLBEING_CUSTOMER_ENABLED=false
CARE_WELLBEING_REQUEST_ENABLED=false
WELLNESS_ROUTINE_ENABLED=false
CARE_WELLBEING_RETENTION_DAYS=30
```

These switches control ingestion, customer data projection and watch-command
dispatch. They are not account access restrictions. Enabling them does not alter
consent, plan access, quality labels or the no-wearing-confirmation rule.

## Daily routines

Family and Care customers can choose Manual, Gentle (two daily times) or Balanced
(three daily times), using `Indian/Mauritius` and exact `HH:mm` slots. Times are saved as
an application schedule; the gateway claims each slot transactionally, skips
missed slots without catch-up, and rechecks access, consent, connection and
measurement state immediately before dispatch.

Temperature is requested only after usable heart/BP and oxygen results. The
scheduled sequence records the position as unknown and reports observed uploads;
neither a nonzero reading nor a successful follow-up proves wrist contact.
Removal monitoring remains a separate disabled control and is not part of routine
authorization.

## Safety and release status

- No diagnosis, emergency clearance or normal/abnormal classification.
- Every customer value carries freshness/receipt context and estimate wording.
- Backend writes remain Admin SDK-only; clients cannot forge readings, steps or
  routine status.
- Firestore reads are bounded by the edition history window.
- Retention cleanup remains bounded and consent-aware; TTL configuration is a
  separate deployment concern.
- Exact-device reliability, battery behavior and medical-language/privacy review
  remain QA work before a broader production rollout.

The implementation is ready for `main`; the remaining work is operational QA,
not renewal of a viewing pilot.

# Guardian customer plan catalog

The customer-facing plan choices are:

- **Guardian Family** — the main family safety plan.
- **Guardian Care** — Family plus the care and wellbeing services.

`essential` remains an internal entitlement value so existing legacy
subscriptions continue to receive their previously granted core-safety access.
It is not a new customer choice.

## Admin subscription changes

New or renewed customer subscriptions should use `family` or `care` with
`gateway/scripts/set-service-subscription.js`. The command rejects
`--plan essential` unless `--legacy-essential` is supplied for an existing
legacy record.

## One-time legacy migration

To preview the linked profile for a watch and see whether it is Essential:

```powershell
cd C:\Users\MSI\repos\guardian\gateway
npm run subscription:migrate-essential -- --imei <15-digit-watch-imei>
```

If the preview reports `currentPlan: "essential"`, rerun it with `--confirm` to
upgrade that profile to Family. Family and Care profiles are left unchanged.

This migration changes only the trusted service subscription plan. It does not
alter consent, caregiver membership, watch settings, or Care-only entitlements.

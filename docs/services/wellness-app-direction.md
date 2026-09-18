# Shared Wellness and Watch settings

Current direction, 15 September 2026. This supersedes Care-only basic-reading language in the historical #119/#120 handoffs.

## Plans and navigation

| Plan | Shared Home card | Activity and Wellness history |
| --- | --- | --- |
| Essential | Today’s available readings and recorded steps | Today on Home |
| Family | Same metrics and visual structure | Today and six previous Mauritius calendar days |
| Care | Same metrics and visual structure | All available retained history during active service |

The shared metrics are recorded steps, heart rate, blood oxygen, skin temperature and a full-width blood-pressure row. Each metric keeps its own observation/receipt time and availability label. Missing readings and partial-day activity must not become zero or normal results.

- Home → Wellness routine; Home → View Wellness where the plan includes history.
- Wellness history → Wellness routine.
- Account → Watch settings → Wellness routine.
- Watch settings → Location, safety & Care preferences. Core location and fall controls appear before separately labelled Care extras.
- SOS and Safe zones remain in their existing primary navigation. Location reporting only controls location uploads; it does not configure Wellness measurements.

## Routines

Manual, Gentle rhythm (12 hours) and Balanced rhythm (8 hours) are shared choices, independent of history length. The controls explain intervals can include overnight readings. Steps record independently.

The current rollout is a private hardware trial. Public/ungranted views show the choices and their availability without mounting private data streams or sending requests. A current server-owned grant, linked account, consent and backend runtime checks remain required. A saved request is not an applied schedule, and a sent command is not proof of a successful measurement.

Manual temperature upload and display are proven by the captured `btemp2,1,36.68` example. The two-label firmware reply is parsed. Neither proves automatic temperature support. Current-session temperature mode evidence and dependable exact-watch wearing evidence remain unresolved; all-zero worn/removed samples must not be reinterpreted as a validated wearing signal. An offline watch can retain an earlier native schedule until a stop reaches it.

Medication preferences are available to Guardian Family and Guardian Care; care-profile editing remains Guardian Care-only. Weekly WhatsApp reports, advanced Wellness comparisons and personal-pattern notices are labelled planned. Basic readings must never be presented as a Care-only upsell.

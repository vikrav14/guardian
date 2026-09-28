# Movement reminders in the Guardian app

Agreed scope requested on 28 September 2026 after the pilot's remote on/off
setting test passed: give movement reminders a clear place in the app.

## Placement and language

**Watch settings → Wellness → Movement reminders.** Add a second action beside
the existing Wellness routine action in the Wellness settings card. Use the same
Guardian cards, colours, spacing and readable content width. On narrow screens
the actions and time controls wrap vertically.

Use “Movement reminders” in the product rather than the device's “Sedentary”
wording. The heading is “A gentle nudge to move”. Keep this in Wellness; it is
not an emergency alert or another large Home dashboard card.

The intended controls are enable/disable, an inactivity interval and active
hours. Start with the observed 20-minute interval. The first layout supports
one daytime window; do not imply that arbitrary intervals, overnight windows,
multiple periods or weekday scheduling have been accepted on the watch.

## Connected supervised pilot (28 September follow-up)

The user next requested connected controls and the physical reminder test.
`movement_reminders_page.dart` now provides a separate authenticated pilot path;
see [the app trial runbook](../testing/movement-reminder-app-trial.md).
It uses an inactivity interval / active-hours contract, scoped captured-format
sender, durable request audit, version checks and no automatic retries.
The explicit signed-in account/device pilot permits Jesh's active Family profile
without changing the subscription. Normal customer Care visibility is unchanged.
The original preview remains available behind its existing flag.

The software path does not establish physical reminder behavior. Customer launch,
physical sound/vibration and active-hours acceptance remain pending. The sections
below describe the initial preview and the customer acceptance requirements.

## Initial preview

The new screen lets an internal reviewer try a local example toggle and daytime
start/end times. 08:00–20:00 is explicitly an **example**, not a tested wire value
or the wearer's actual schedule. Local example edits do not persist or send any
request. “Save to watch” is disabled and the actual watch state is “Not checked”.
The preview has no service instance, Firestore reads/writes or command sender.
The existing fixed-clock schedule model is not used as an inactivity interval.

The entry and direct page both keep the current active-Care entitlement and
`GUARDIAN_CARE_REMINDERS_ENABLED` gate (default false). This change does not widen
editions or activate customers. The pilot profile Jesh currently has Family, so
the normal Family app will not show this Care-only preview. Do not change the
live subscription just to view it; the isolated content widget is available to
widget tests and future visual review. Any Family rollout requires an explicit
product decision plus matching backend/rules changes.

## Work before a working customer control

- Integrate the observed frame format into a scoped normal sender. The temporary
  preload is not a production dispatch path.
- Finish physical inactivity reminder acceptance and verify active-hour behavior.
- Give movement settings their own interval/active-hours request contract. The
  existing `careReminderSchedules.localTime` schema describes fixed clock times;
  passing it to SEDENTARY would invent semantics.
- Maintain linked-member authorization, entitlement checks, audited changes,
  offline/pending/failure states and protection against duplicate sends.
- Keep desired settings, command handoff, device reply and observed application
  distinct. A bare echo is not an “On on the watch” confirmation. Our physical
  pilot result is not a persistent readback available to every app user.
- Show actual applied state only when a supported evidence source exists. Do
  not label the preview switch or a queued request as the current watch state.
- Use one caregiver save action for the complete setting; avoid exposing the
  supplier app's two independent Save buttons. Preserve partial failures if
  interval and active hours require separate commands.

The timed sound/vibration test, status readback and normal save integration remain
open in PR #118. This preview is not deployed and is not a release-ready control.

# Wellness history: grouped readings and charts

PR #120 / `feat/v52-care-wellbeing`. Implements the approved interactive
Wellness history concept in the existing Flutter app.

## What families see

- Activity and Watch readings tabs, with Today and 7-day selection.
- Heart rate, blood oxygen, blood pressure and skin temperature cards. Each
  card has its own latest value, timestamp and age for the selected period.
- A chart for the selected metric. Hover, tap or use left/right arrows to
  inspect saved observations. Blood pressure keeps systolic and diastolic
  values paired at the same timestamp.
- Recorded ranges, reading counts and days with data, without health scores,
  medical classifications, interpolated readings or percentage improvement.
- A collapsed reading log grouped by Mauritius date, with incremental loading
  for longer lists. Changing period preserves the selected tab and metric.
- Activity bars and a daily log. Missing days remain gaps, a recorded zero
  remains zero, and partial totals are labelled. Historical periods describe
  the latest recorded day in that period rather than calling it today's value.
- Responsive layouts for narrow phones, desktop, dark theme and larger text.

## Access and evidence boundaries

Essential retains today's dashboard without a history route. Family retains
today plus the preceding six Mauritius calendar days. Care retains earlier
week/date navigation within existing retained data. Period selection rebuilds
the existing scoped streams; no new Firestore collection or query scope is
introduced. Consent, linking, subscription and pilot-grant checks remain in
their existing service and route layers. Errors hide old plots and logs.

Charts use optional typed numeric values carried from existing authorized
`WellbeingReading` records into `WellnessSample`; formatted display strings
are never parsed for graph values. Legacy text-only samples remain readable
in the log. Future and out-of-window samples are excluded.

Skin temperature remains private preview only. Temperature timestamps say
Received, and its chart explicitly uses receipt time because measurement time
is unconfirmed. The private-preview explanation remains accessible beneath
the chart. No wearing, sensor acceptance, scheduler, notification, customer
report or gateway behavior is changed by this UI work.

## Verification

- New unit/widget coverage: date and midnight filtering, numeric chart values,
  paired pressure values, temperature access loss, errors and empty periods,
  missing versus zero activity, metric and period actions, keyboard inspection,
  320/1200-pixel layouts and normal/doubled text size.
- Firestore adapter checks cover all four numeric metrics while retaining
  temperature preview gating.
- Production-widget preview renderer now captures Family/Care history at
  phone and desktop widths, plus pressure, temperature and activity views.
  Fixtures are synthetic and labelled; no customer account or hardware is used.
- The complete release gates passed at `f906e9a`: Flutter analysis, tests,
  Chrome regression and Web release build; gateway tests; Firestore
  authorization. UI formatting, layout tests and all 20 production-widget
  preview images also passed. Phone and desktop reading, pressure, temperature,
  activity and Care navigation views were visually reviewed. The final category
  icon refinement receives the same checks; see PR #120 for latest-head status.
  This environment has no local Flutter SDK; CI supplies the pinned SDK.

## QA walkthrough after pulling the branch

Open Wellness history with the existing private pilot grant. Select each
metric, inspect a chart point, and expand the reading log. Compare Today and
7 days; the chosen metric should remain selected. Switch to Activity and
confirm missing dates are gaps. For Care, inspect an earlier week and return
to the current week. Refresh or remove source access and confirm old values
are cleared. Repeat at phone width and larger text size.

No gateway restart or Firestore rules deployment is required for this UI
change. The supplier's wearing-state investigation and PR #119/#120 hardware
acceptance/scheduler checklist remain open separately.

Wiki mirror: this is the QA-facing source note. Mirror into the project Wiki
when Wiki write access is available; the current connector exposes repository
and PR updates, not Wiki writes.


## Card and chart refinement

The shared `GuardianSurface` adds a subtle diagonal tint, a restrained shadow
and consistent rounded borders. It is used by dashboard/place panels, Wellness
cards and history, GuardianCard consumers (account and watch settings), grouped
settings lists, alert rows/details, sign-in and the main Journey cards. Metric
tiles retain their own rose, blue, amber and violet accents. Controls keep their
Material ink surface, action keys and selected/critical states. Elder Care and
system high-contrast mode use a solid fill, stronger border and no shadow.

Heart-rate and pressure charts now draw faint straight guides between adjacent
saved readings up to 24 hours apart. Actual dots and the paired systolic and
diastolic series remain visible. Gaps longer than a day, missing/non-finite
values and duplicate/out-of-order timestamps break guides; a single reading
stays a single point. No smooth curve, fabricated sample, health threshold or
extrapolated current value is introduced. Activity, oxygen and temperature keep
their existing presentation.

Focused checks cover separated pressure series, guide gaps, nested card
controls and expansion tiles in light/dark/high-contrast palettes. Existing
production-widget previews cover dashboard, Wellness, settings, sign-in and
safe zones; existing journey and alert tests protect their interactions.
Latest-head CI and visual review results are recorded in PR #120. The QA Wiki
mirror still needs an available authenticated Wiki write capability; this
repository note is the reviewable QA record.

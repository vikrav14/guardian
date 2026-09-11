# Dashboard UI refinement

The previous dashboard repeated location, journey and AI information across a
large hero, a row of feature cards and an intelligence panel. The floating dodo
competed with the wearer and watch status. The new overview gives each piece of
information one clear place and uses readable text, quiet surfaces and consistent
spacing.

## Layout

- On phones, the identity card uses a compact avatar/name, a separate watch
  status row with battery, and equally sized Call watch / View journey actions.
  Guardian help is a labelled icon beside the person. Its existing plan dialog
  remains available when locked; watch status opens the same evidence dialog.
- The location card gives the displayed source and timestamp one place: a source
  heading and age badge, with full source/age available to accessibility and the
  tooltip. The age comes from the map fix, independently of watch check-in.
- A 210px phone map keeps the location prominent without dominating the screen.
  Existing zoom, centering, satellite controls and location-details action stay.
  The reference image's decorative fullscreen control is not a new navigation
  action in the app.
- Old GPS, retained GPS, network estimates, missing timestamps and the Home Wi-Fi
  source each retain factual explanations. The amber stale-GPS notice uses the
  existing location freshness duration for display only; map/safety selection
  logic is unchanged. Unknown/future timestamps never display as fresh.
- Safe zones list configured places without claiming the wearer is inside them.
  Family plans keep Guardian insight; the existing Care Today summary retains its
  own entitlement. All secondary content remains reachable by scrolling.
- Wide screens show the map beside supporting cards. Small screens and enlarged
  text stack cleanly. Empty-by-default `serviceSections` follow the main overview
  for future authorized activity and wellbeing panels.
- Navigation now occupies reserved space instead of covering map/cards. Tab
  indices and the three-second hold-to-send SOS interaction remain unchanged.
  It is labelled "SOS / Hold 3 sec" because there is no SOS-options destination.
- Loading, disconnected data and the first-watch empty state remain distinct.

The dashboard does not render the dodo. Existing mascot assets and older shared
widgets remain available to other screens and in-flight branches.

## Rendered review images

These are the actual Flutter overview widgets using synthetic people and a
labelled test map. Production continues to use the existing Google Maps view.

![Desktop overview](images/dashboard-overview/wide.png)

[Phone overview](images/dashboard-overview/mobile.png) ·
[Dark phone overview](images/dashboard-overview/mobile_dark.png) ·
[390 × 844 viewport](images/dashboard-overview/mobile_viewport.png)

The viewport capture uses the real bottom bar and overview with a static brand
header fixture. The other captures show the complete scrollable overview. All
captures use synthetic people and a labelled test map, not live account data.

## Scope and parallel work

Branch: `feat/dashboard-ui-refinement`, based on `main` at `0afd652`.

The overview widgets are presentational. The dashboard page still owns calling,
help, entitlement checks, map controls and journey navigation. This change does
not alter the gateway, Firestore, telemetry, SOS or location selection models.
The platform map has a stable key across responsive rearrangements and camera
updates are guarded against a replaced controller.

Reviewed open PR heads on 2026-09-11. Service PRs #111–121 are all draft;
no unfinished service branch is merged or enabled by this UI change.

| PR / audited head | Integration requirement |
| --- | --- |
| #116 Home Wi-Fi / `89591de` | Keep `mapDisplayLocation`, source-aware page status and `deviceMapLocationFixLabel`. Home radio evidence means at or near the saved Home pin; preserve expiry, newer GPS precedence, separate retained GPS details and uncertainty-circle suppression. |
| #119 Activity / `778477b` | Insert `ActivityStepsPanel` through `serviceSections`, preserving `GUARDIAN_ACTIVITY_STEPS_ENABLED=false`, the `activitySteps` decision, subscription and the panel's locked Essential boundary. |
| #120 Wellbeing / `78f4311` | Insert `WellbeingReadingsPanel` through `serviceSections`, preserving `GUARDIAN_CARE_WELLBEING_ENABLED=false`. Query only with a permitted Care decision and subscription; keep consent/linkage/displayable rules, timestamps and estimate wording. |

Only those three service PRs touch the dashboard page. None touches the new
presentation widgets, shell or navigation. A three-way file check against the
compact UI head `82f8c6cb` found no map-page conflict with #116; #119 and #120
have import and old-composition conflicts requiring deliberate integration.
A clean file merge is not runtime validation. Repeat against the actual merge
heads, including #116's `home_wifi_display_test.dart` and expiry without a new
Firestore event. For activity/wellbeing, test flags off, plan/consent boundaries,
missing and stale data, and switching the selected watch with stable device keys
so old readings cannot appear under another wearer. Run the combined Flutter and
Firestore gates before merging services.

The `home_wifi` display-source contract is covered by a synthetic overview test;
this does not enable or replace #116's radio evidence validation. Empty service
slots initiate no streams and render no unavailable-feature placeholders.

## Verification

`Guardian release gates` runs the existing Flutter analysis, full test suite,
web build, gateway tests and Firestore checks.

`Dashboard UI review` checks formatting, runs overview, navigation/SOS, shared widget and login tests and
renders the actual widgets with synthetic data at phone and desktop widths.
Its `guardian-dashboard-previews` artifact contains PNGs. The test map is clearly
labelled and contains no live wearer data, credentials or map service calls.

To reproduce locally from `apps/mobile`:

```sh
flutter pub get --enforce-lockfile
flutter test test/guardian_dashboard_overview_test.dart test/guardian_navigation_test.dart test/widget_test.dart
flutter test tool/render_dashboard_previews_test.dart --dart-define=DASHBOARD_PREVIEWS=true
```

The image capture tool uses a local font for reproducible offline text rendering.
The production app retains its existing typography. Live Google Maps interaction,
real profile photos and device performance still need normal app playtesting.

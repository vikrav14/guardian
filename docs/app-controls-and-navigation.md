# Guardian controls and navigation

Guardian uses one control system on Android and web. `theme/app_theme.dart`
defines the defaults; `GuardianControlStyles` provides the few explicit
variants. New screens should inherit these styles instead of choosing another
button shape or hard-coded foreground colour.

## Controls

- Filled / elevated: the principal action, with a readable shade of the chosen
  Mauritian palette. Outlined: an alternative action. Text: a lighter action.
- All three use 16 px corners, 14 px semibold labels, and at least a 48 px touch
  target. Height can grow with enlarged text; avoid fixed-height text buttons.
- Destructive controls use the shared destructive variants, including disabled
  states. Loading indicators must remain visible on disabled surfaces.
- Icon actions have a 48 px target and a descriptive tooltip. Settings rows
  consistently show a chevron for navigation, including rows with a value.
- Status colours, weather artwork, the Mauritius logo and its pulse are separate
  from action colours. Preserve their meaning and appearance.
- Use +230 guidance, Mauritius scheduling context, and local spelling where
  relevant. Keep existing consent, roles, subscription and watch behaviour.
- Simple dialog inputs use `TextFormField` with `initialValue` / `onChanged`,
  so the field owns its controller until unmount. Do not dispose controllers
  immediately after `await showDialog`: that future resolves before the closing
  animation ends, which can crash a focused field. More complex editors should
  own their controllers in the dialog widget's State.

## Navigation

`GuardianNavigationShell` owns the single Home / Safe zones / Family / Watch
bar. All signed-in detail pages use its nested navigator. This includes watch
preferences, wellness, Home Wi-Fi, Journey, voice messages and incident photos
opened from a link. They inherit the same theme and entitlement scope.

Back returns one level. Selecting a tab returns to that destination's root,
respecting any page that prevents leaving during an operation. Confirmations
remain modal. Login has no authenticated navigation. The safe-zone map picker
and its containing form use the nested navigator so leaving cancels the flow.
The shell passes only the keyboard inset overlapping its body to nested pages,
so the bottom bar's reserved height is not counted twice.

## Safe-zone creation

`SafeZoneEditorPage` replaces the cramped creation dialog with a responsive
page: a person/place card and a boundary card, side by side on wider screens.
Home, School and Grand-mère’s presets complement editable names; radius presets
complement a validated 50–5,000 metre field. Confirm the centre in the map picker
before saving, then review the circle in the form. A watch's last reported
position is only a starting point for the picker, never an implicitly saved
centre. Keyboard dismissal preserves the draft, and Create stays above the
keyboard. Save failures preserve all values; pending saves block repeated
submissions and navigation. Leaving the form or picker via a tab discards the
unsaved draft without changing live safe zones.

## Verification

- Flutter suite: navigation/back/cancellation, Family permissions and consent,
  watch preferences and reminders, wellness, voice, photos, maps and alerts.
- Control tests cover all seven palettes, 4.5:1 action-text contrast, enlarged
  text at 320 px, disabled actions and destructive variants.
- `tool/render_controls_previews_test.dart` renders real watch-preference and
  Home Wi-Fi widgets at 390 / 1280 px in light, dark and high contrast. It uses
  synthetic data and a local substitute font, never a live watch.
- Physical Samsung review verified Home/weather, Family, Watch settings,
  Movement reminders and switching from a nested page with the bottom bar.
  Account, emergency contacts, watch preferences and wellness were also
  inspected before the update. The final APK, including the focused-dialog
  crash fix, was installed on 7 October. Repeating focus + Cancel in invitation,
  watch-linking, safe-zone and contact forms now succeeds on the phone.
- A focused invitation cancellation test reproduced the original controller
  disposal failure and `_dependents.isEmpty` cascade before the fix. Regression
  coverage checks Cancel, Android Back, reopening and accepting a trimmed code
  through a fake client; no live invitations or settings are submitted.
- Safe-zone editor tests cover keyboard geometry at 320 px / enlarged text,
  390 px and desktop width; validation and exact saved coordinates/radius;
  picker cancellation, back/tab navigation, saving guards and recoverable
  failures. Physical-phone review checks keyboard layout and a selected-centre
  preview without creating a live zone.

Screenshots and device-specific verification remain local; do not commit
account details, phone numbers, device identifiers or private build settings.

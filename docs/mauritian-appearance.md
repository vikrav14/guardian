# Mauritian appearance and navigation

The shared Flutter app uses five island themes on Web and Android: Blue Bay
(default), Le Morne, Pamplemousses, Chamarel and Flic-en-Flac. Each theme applies
to scenery, cards, buttons, forms and dialogs. The home overview includes the
compact weather panel, status and watch actions in the same card treatment.

Appearance preferences are local to the installation/browser. Scenery can be
disabled or softened, and high contrast removes the scenic layer. Existing
palette keys migrate to the nearest new palette; the former Elder Care choice
also retains high contrast. Changing appearance keeps the navigator alive.

## Navigation

At desktop widths the full sidebar groups general pages and the selected
watch's pages. Below 1100 logical pixels, or with larger text, a 56-pixel icon
rail stays visible. Its toggle opens a labelled drawer over the page; choosing
a destination closes it. The menu scrolls on short screens and exposes icon
labels to accessibility services.

Shortcuts open the existing pages for Journey, Wellness, Watch settings,
Safety & preferences, Home Wi-Fi and Emergency contacts. Shared-watch
permissions and subscription checks still apply. Home Wi-Fi remains
owner-only. Navigation respects existing back/save guards. The underlying
tab pages keep their state while opening the menu or resizing the window.

This change includes presentation, local appearance persistence and navigation
wiring. It does not modify the gateway, Firestore rules, watch commands,
reporting cadence or alert processing. The everyday weather panel is compact;
an applicable local update still reserves a stable area while switching
between the update and weather, with the existing expiry and eligibility rules.

## Verification

From `apps/mobile`:

```sh
flutter analyze
flutter test
flutter build web --release
flutter build apk --debug
flutter test tool/render_side_menu_test.dart
flutter test tool/render_mauritian_themes_test.dart --dart-define=THEME_PREVIEWS=true
```

The render helpers use synthetic data and write PNGs to
`build/menu-previews/` and `build/mauritian-theme-previews/`. The menu helper
captures all five themes at 320/390-pixel phone widths and desktop width,
including the expanded mobile drawer.

For manual review, switch themes on Home and a detail screen, then open a
dialog. Check the weather, status and actions; collapse/expand the phone menu;
select another screen; resize desktop to phone; and check large text and
screen-reader navigation. A menu toggle must not reset an unsaved form, and a
page that blocks leaving must continue to block sidebar navigation.

Builds and synthetic UI checks are software evidence only. They do not prove
new physical-watch behaviour or install/publish a release.

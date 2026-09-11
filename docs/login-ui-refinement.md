# Guardian welcome and sign-in

The public welcome screen now introduces Guardian through family connection:
“Their independence. Your peace of mind.” The original family photograph and
short messages for parents and children make the service's purpose clear before
sign-in. The image is illustrative, not a customer testimonial; its generation
prompt and provenance are in [login-image-source.md](login-image-source.md).

## Layout and behavior

- Desktop: Guardian's existing pin and wordmark, a family story beside a focused
  sign-in form, and a short list of location, calling and SOS capabilities.
- Narrow screens and enlarged text: the form comes before the photograph and
  supporting story. All content scrolls when the keyboard reduces usable space.
- The form follows the selected app theme, with readable field labels, autofill,
  keyboard submission, password visibility controls and 48px minimum actions.
- Registration and password reset use the existing authentication service. New
  accounts still start without linked watches. No plan or watch data is changed.
- Repeated submissions are guarded while a request is pending. Error and reset
  messages are announced, and late requests cannot update a disposed screen.
- The 1536 × 1024 family image is bundled as a roughly 98 KB WebP, requiring no
  remote image host or customer image data.

## Review

The UI workflow runs login behavior/layout tests and captures the real login and
registration widgets with fake authentication. The captures use local fonts for
offline reproducibility; production keeps Guardian's existing typography.

From `apps/mobile`:

```sh
flutter pub get --enforce-lockfile
flutter test test/login_page_test.dart
flutter test tool/render_login_previews_test.dart --dart-define=LOGIN_PREVIEWS=true
```

The screenshot artifact is `guardian-login-previews`. Actual Firebase sign-in,
browser password-manager behavior and a phone keyboard still need normal app
playtesting; CI does not access real accounts.

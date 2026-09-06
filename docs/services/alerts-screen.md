# Alerts screen

Implemented on `feat/v52-callback-sos` for the Android/Web Flutter app.
The previous list resolved an alert immediately when Review or Dismiss was
tapped. Its category chips did not filter, and its Today heading covered the
whole unresolved list. The replacement makes these actions explicit.

## Review and history

- Open and History use the existing linked-watch stream. History contains
  resolved records within the same most-recent-100 query, not an unlimited
  archive. The existing query's maximum of 30 linked IMEIs also remains.
- All, Safety, Device and Places filter the returned records. Unknown types
  remain visible in All; critical events also appear in Safety.
- Calendar headings use the viewer's local Today, Yesterday or full date.
  Each incident retains its own ID, even when several SOS alerts look similar.
- Tapping a row opens details without a write. Desktop shows list and details
  together; narrow screens show details with a Back action. The existing
  bottom navigation and three-second global SOS action are unchanged.
- Technical `Device alarm: sos` copy becomes a wearer-oriented title and one
  explanation. Existing custom titles/messages are retained. App-origin help
  requests are distinguished from a physical watch button press.

## Actions and failure handling

- Call watch is available for SOS/fall when that incident's linked watch has
  a saved SIM. It uses normal `tel:` calling, with the existing dashboard's
  desktop number/copy/handoff pattern. Data-offline status does not imply voice
  is unavailable. This action does not send MONITOR or another watch command.
- Mark as resolved requires confirmation. It writes only the existing
  `resolved` and `resolvedAt` fields through `AlertService.resolve`. Resolution
  is shared by linked guardians. The stream confirms the History transition;
  opening, calling, viewing a map and cancelling the dialog do not resolve.
- While saving, resolution is disabled. Failure keeps the record open with a
  retryable error. The current stream is rechecked after confirmation so a
  removed or already-resolved incident does not trigger another write.
- Stream errors are reported as unavailable data, never as a safety claim.
  A watch-detail error disables stale call actions while recorded incident
  evidence remains accessible.

### Clear all

Clear all is available in Open and applies to the current category: Places
clears the displayed Places alerts, while All includes every loaded open alert.
It is disabled for an empty view or while resolution is pending, and is absent
from History. It resolves records into recent History; it does not delete them.

Confirmation names the count and category, calls out any SOS/fall alerts, and
explains the shared effect for linked guardians. The selected IDs are frozen
before the dialog opens. Later arrivals are never added to the operation.

After confirmation, the screen rechecks visibility, IMEI and resolution. The
service then verifies current watch linkage and incident identity in one
Firestore transaction, reads all targets before writing, and updates only
`resolved` and `resolvedAt`. Already-resolved records retain their original
resolution time. A failed group cannot partially commit; the user gets a retry
message. The existing latest-100 query limit remains visible and unchanged.

Regression coverage is in `alerts_page_test.dart`,
`alerts_bulk_resolution_test.dart` and
`firestore/test/alerts-bulk-resolution-rules.test.js`. The emulator verifies
the existing rules support all 100 records without weakening authorization or
SOS snapshot protection.

## SOS location

The detail panel reads only the backend-owned top-level `sosLocationSnapshot`
on SOS records. The typed reader validates version, policy, state, coordinates
and receipt time against the gateway reader. It recomputes evidence age at
receipt and does not use today's watch location or a snapshot inside payload.

Retained satellite GPS remains last-known even inside ten minutes. Source,
recording time and age are shown together. A network observation and its radius
remain separate from the primary GPS map. Invalid, unavailable and legacy SOS
records without a snapshot have no incident map. No migration is required.

WhatsApp templates, callback pilot selection, notification delivery, gateway
SOS handling, Firestore queries/rules and watch configuration are unchanged.
See [SOS location](sos-location.md) for the authoritative snapshot contract.

## Verification

- `flutter test test/alerts_page_test.dart`: read-only review/actions, explicit
  resolution, pending/failure/realtime changes, categories/history, independent
  incidents, frozen maps, unavailable data and narrow/desktop large-text layout.
- `flutter test test/alert_presentation_test.dart test/watch_call_actions_test.dart`:
  honest copy, calendar boundaries, saved-SIM handoff and failure feedback.
- `docs/testing/sos-location-snapshot-reader.json` runs against both the Dart
  reader and the actual gateway reader, including fresh/stale boundaries,
  retained GPS, unknown times/sources, future observations and malformed data.
- Full release gates still cover gateway tests, Flutter analyze/test/Web build
  and Firestore authorization. Automated UI tests do not replace a real app
  check on the user's watch/account.

# Guardian Mobile App Overview

## Summary

The Guardian mobile app is a Flutter-based safety dashboard that allows guardians to track linked GPS pendants, receive alerts, manage safe zones, and coordinate family access through Firebase authentication and Firestore. The app is built for **Android and Web only** — no iOS target exists.

The app uses a modern stack: Firebase Auth for identity, Firestore for real-time data, Google Maps for visualization, and Flutter for cross-platform UI. Push notifications arrive via Firebase Cloud Messaging (FCM) with local fallback notifications.

---

## App Architecture

### Core Technologies

| Component | Purpose |
|-----------|---------|
| **Firebase Auth** | User sign-up, login, and session management |
| **Firestore** | Real-time database for devices, alerts, geofences, reminders |
| **Google Maps** | Map visualization of device locations and safe zones |
| **Firebase Messaging (FCM)** | Push notifications to app; local notifications via `flutter_local_notifications` |
| **Firebase Storage** | Avatar image hosting for users and devices |

### Directory Structure

```
apps/mobile/lib/
├── main.dart                    # App root, Firebase init, theme & locale setup
├── screens/                     # One .dart file per screen (navigation containers)
├── services/                    # Firestore operations & business logic (guardian_services.dart)
├── models/                      # Data classes (device, alert, geofence, etc.)
├── widgets/                     # Reusable UI components
│   ├── dashboard/               # Dashboard-specific widgets (Dodo character, device cards)
│   ├── map/                     # Map rendering (markers, overlays, layers)
│   ├── safe_zones/              # Safe zone management UI
│   ├── cards/                   # Reusable card containers
│   ├── layout/                  # Page structure (headers, frames)
│   ├── navigation/              # Navigation UI (bottom bar, header)
│   ├── brand/                   # Brand assets and logos
│   └── theme/                   # Theme switcher and styling
├── dashboard/                   # Dashboard logic (status colors, controllers)
├── journey/                     # Journey replay/history (time machine, controls)
├── safe_zones/                  # Geofence validation logic
├── navigation/                  # Navigation state (HomeShellScope)
├── l10n/                        # Localization (en, fr, mfe)
├── theme/                       # App theme (colors, typography)
└── firebase_options.dart        # Firebase config (generated)
```

---

## Navigation Map

The app uses **tab-based navigation** inside a shell container:

### Tab Structure (HomeShell)

```
┌─────────────────────────────────────────┐
│ Guardian App Header (logo, quick links) │
├─────────────────────────────────────────┤
│                                         │
│  [Current Tab Page]                     │
│  (IndexedStack switches between tabs)   │
│                                         │
├─────────────────────────────────────────┤
│ Bottom Navigation Bar (+ SOS FAB)       │
│ ┌──────┬──────┬──────┬──────┬─────┐   │
│ │ Home │ Zones│Alerts│Account│ SOS │   │
│ └──────┴──────┴──────┴──────┴─────┘   │
└─────────────────────────────────────────┘
```

### Authentication Flow

```
GuardianApp (root)
  └─ GuardianThemeScope (theme state)
      └─ AuthGate (redirects based on auth state)
          ├─ [Unauthenticated] → LoginPage
          └─ [Authenticated] → ProfileLoad → HomeShell
```

### Screen Stack

| Tab | Screen | Route | Purpose |
|-----|--------|-------|---------|
| 0 | **Dashboard** | `MapDashboardPage` | View live location, device status, select active device; shows Dodo character state |
| 1 | **Safe Zones** | `SafeZonesPage` | Create/edit geofences; view radius and WiFi SSIDs; toggle zones on/off |
| 2 | **Alerts** | `AlertsPage` | Browse recent alerts (SOS, geofence, low battery, offline); resolve or dismiss |
| 3 | **Account** | `AccountPage` | Settings, link/unlink pendants, family invites, emergency contacts, language/theme |

### Sub-Screens (Modal/Navigation)

| Screen | Parent | Purpose |
|--------|--------|---------|
| `CareSettingsPage` | Account (via device card dialog) | Fall detection, medication reminders, location upload frequency (V46/V48/V52 only) |
| `EmergencyContactsPage` | Account | Add/edit phone numbers for SOS/fall/geofence alerts |
| `LocationPickerPage` | Safe Zones (modal) | Pick map center for new safe zone |
| `JourneyPage` | Dashboard (via device tap) | Replay journey history, compare routes, share exports |
| `LoginPage` | AuthGate | Email/password login or Google Sign-In |

---

## Key Screens & Features

### 1. Dashboard (MapDashboardPage)

**Purpose:** Real-time location tracking and device status monitoring.

**Key Elements:**
- **Google Map** — shows device location, geofence circles, journeys
- **Device Card** — taps to select active device; shows status (live, offline, linking, low battery)
- **Dodo Character** — visual state indicator reflecting current app/pendant status
- **Status Label** — "Live location", "Approximate location", "Last known location", "Linking up", "Connected • Locating"
- **FAB (SOS Button)** — sends help alert to gateway and emergency contacts

**Dodo States:**
- `DodoStageMode.active` — Guardian is live, all channels ready (asset: `guardian_dodo_live.png`)
- `DodoStageMode.offline` — Listening for pendant reconnection (asset: `guardian_dodo_pendant.png`)
- `DodoStageMode.linking` — Device is newly linked, cycling through connection stages

**Linking Story (5-step animation):**
1. "Listening for the pendant" — waiting for first signal
2. "Finding the network" — making secure connection
3. "Finding the location" — checking GPS/signals
4. "Guardian AI is checking" — preparing first trusted update
5. (Auto-clears when linked)

**Map Features:**
- Device location marker with avatar
- Safe zone circles (green when inside, red when outside)
- Journey route playback (compressed segments from Firestore)
- Tap device card to open journey replay modal

### 2. Safe Zones (SafeZonesPage)

**Purpose:** Create and manage geofences for alerts and status tracking.

**Features:**
- **Create Zone** — dialog to:
  - Pick device
  - Enter zone name (default: "Home")
  - Set radius in meters (default: 150m)
  - Optionally link WiFi SSID for offline matching
  - Pick center on map or use current location
- **Zone List** — cards showing:
  - Mini map preview
  - Status chip (inside/outside)
  - Toggle on/off (disables notifications)
  - Delete option
- **Toggle & Delete** — immediate updates via GeofenceService

**Geofence Model Fields:**
- `imei` — device it monitors
- `name` — user label
- `active` — enable/disable
- `center` — {lat, lng}
- `radiusMeters` — notification trigger distance
- `wifiSsid` — optional; device must support WiFi decoding (currently not populated in production)
- `createdBy` — UID of creator

### 3. Alerts (AlertsPage)

**Purpose:** Historical review of safety events.

**Alert Types & Tones:**
| Type | Severity | Tone | Icon |
|------|----------|------|------|
| SOS | critical | Danger | ⚠ Warning Amber |
| Fall | critical | Danger | ⚠ Warning Amber |
| Geofence Exit | warning | Warning | 🛡 Bad |
| Geofence Enter | warning | Warning | 🛡 Bad |
| Low Battery | warning | Warning | 🔋 Battery 1 Bar |
| Offline | warning | Warning | 📡 No Signal |

**Actions:**
- "Review" (critical alerts)
- "Dismiss" (warning/info)
- Mark as resolved (updates `alerts/{id}.resolved`)

**Streaming:** Pulls recent 100 alerts for all linked devices; filtered by user's `linkedImeis`.

### 4. Account (AccountPage)

**Purpose:** User settings, device management, family sharing, emergency contacts.

**Sections:**
1. **Avatar & Profile** — upload guardian's photo via Firebase Storage
2. **Subscription Status** — displays tier (free/premium); read-only (no payment processor wired)
3. **Linked Devices** — list with edit/unlink options
   - Tap device card to edit: name, nickname, relationship, avatar
   - Long-press to delete
   - "Link Pendant" button — opens IMEI entry dialog
4. **Family & Invites**
   - Create invite code (6-char alphanumeric, copied to clipboard)
   - View pending invites sent
   - Accept invite (code entry dialog) — links to inviter's devices
   - **Known bug:** Acceptor's UID not added to inviter's `familyMembers` list
5. **Emergency Contacts** — list of phone numbers for SOS/fall/geofence alerts
   - Save/edit via modal dialog
   - Supports WhatsApp field (optional)
6. **Settings**
   - Language picker (en, fr, mfe) — persisted via `LocaleService`
   - Theme picker (light, dark, auto) — persisted via `ThemeService`
   - Logout button

**Care Settings** (per device, accessed via device card)
- Fall detection toggle + sensitivity slider (V46/V48/V52 TCP only)
- Auto-dial monitor on fall
- Location reporting interval (30s, 60s, 2m, 5m presets)
- Medication reminders — time, frequency, weekly pattern, reminder text

---

## Data Flow & Services

### Services (guardian_services.dart)

All Firestore operations are scoped through the user's `linkedImeis` array to enforce security rules.

#### DeviceService
```dart
DeviceService({FirebaseFirestore? db, FirebaseAuth? auth})

// Queries & updates
watchLinkedDevices()                    → Stream<List<Device>>
renameDevice(imei, name)                → Future<void>
updatePersonIdentity(imei, nickname, relationship) → Future<void>
updateAvatarUrl(imei, url)              → Future<void>
linkPendant(rawImei)                    → Future<void>
unlinkPendant(rawImei)                  → Future<void>
updateFallDetectionPrefs(imei, ...)     → Future<void> (TCP + cache)
updateLocationReportingInterval(imei, seconds) → Future<void> (TCP + cache)

// Journey history (V46+ only; V28C has legacy locations collection)
watchDayHistory(imei, day)              → Stream<List<LocationHistoryPoint>>
watchDayJourneys(imei, day)             → Stream<List<JourneyRecord>>
watchDaySegments(imei, day)             → Stream<List<DwellSegment>>
watchDayJourneyData(imei, day, geofences) → Stream<JourneyDayData>
fetchDayHistory(imei, day)              → Future<List<LocationHistoryPoint>>
fetchDaysWithHistory(imei, lookbackDays) → Future<Set<DateTime>>
```

#### GeofenceService
```dart
watchAll()                              → Stream<List<Geofence>>
create(imei, name, lat, lng, radiusMeters, wifiSsid?) → Future<void>
setActive(id, active)                   → Future<void>
delete(id)                              → Future<void>
```

#### AlertService
```dart
watchLinkedAlerts(limit=100)            → Stream<List<GuardianAlert>>
sendHelpAlert(imei, deviceName?)        → Future<void>
resolve(alertId)                        → Future<void>
```

#### UserProfileService
```dart
watchAvatarUrl()                        → Stream<String?>
updateAvatarUrl(url)                    → Future<void>
watchSubscription()                     → Stream<GuardianSubscription>
watchContacts()                         → Stream<List<EmergencyContact>>
saveContacts(List<EmergencyContact>)    → Future<void>
```

#### FamilyService
```dart
watchFamilyMembers()                    → Stream<List<FamilyMember>>
watchMyInvites()                        → Stream<List<FamilyInvite>>
watchIncomingInvites()                  → Stream<List<FamilyInvite>>
createInviteCode()                      → Future<String>
acceptInvite(code)                      → Future<void>
```

#### MedicationReminderService
```dart
watchForDevice(imei)                    → Stream<List<MedicationReminder>>
create(imei, time, frequency, text, week?) → Future<void>
setEnabled(reminder, enabled)           → Future<void>
delete(id)                              → Future<void>
```

### Models

| Model | Source | Fields |
|-------|--------|--------|
| `Device` | `devices/{imei}` | imei, name, nickname, relationship, avatarUrl, simNumber, location (lat/lng/accuracy/age), lastSeen, battery, connectivity, fallDetection.*, locationReportingIntervalSeconds |
| `Geofence` | `geofences/{id}` | imei, name, active, center, radiusMeters, wifiSsid, createdBy, createdAt, updatedAt |
| `GuardianAlert` | `alerts/{id}` | imei, type, severity, message, resolved, notifyStatus, payload (source, requestedBy), createdAt, resolvedAt |
| `LocationHistoryPoint` | `devices/{imei}/locations/{id}` | latitude, longitude, accuracy, timestamp, batteryLevel, source |
| `JourneyRecord` | `devices/{imei}/journeys/{id}` | startAt, endAt, polyline, pointCount, distanceMeters |
| `DwellSegment` | `devices/{imei}/segments/{id}` | from, to, lat, lng, durationSeconds |
| `MedicationReminder` | `medicationReminders/{id}` | imei, time, frequency (0=once, 1=daily, 2=weekly, 3=custom), week (bitmask), text, enabled |

### Real-Time Streams

All streams use Firestore snapshots and rebuild affected widgets via `StreamBuilder`:

- **Device list** — updates immediately when location, battery, connectivity change
- **Geofences** — live toggle/add/delete
- **Alerts** — new critical alerts surface instantly
- **Journey data** — loads on tab open; updated once per day
- **Avatar** — cached; lazily fetched via `firebase_storage`
- **User profile** — subscription status, emergency contacts

---

## State Management & Controllers

### DashboardController

Manages device list, selection, and connectivity state:
```dart
DashboardController()
  .devices              → List<Device>
  .selectedImei         → String? (which device is active)
  .geofences            → List<Geofence>
  .isLive(device)       → bool (has fresh location < 5 min)
  .isReconnecting(device) → bool (just linked, < 30 sec)
  .error                → Object? (Firestore error)
  .loading              → bool
  .addListener(callback) → void
  .start()              → void (begins watching streams)
  .dispose()            → void (cancels subscriptions)
```

### GuardianThemeScope

InheritedWidget holding theme state above MaterialApp; allows `GuardianApp.setTheme()` to switch colors live without rebuilding navigator.

### HomeShellScope

Navigation context for bottom bar; tracks which tab is active.

---

## Localization

The app supports **three locales:**
- `en` (English) — default fallback
- `fr` (French)
- `mfe` (Kreol Morisien)

**Implementation:**
- Generated via `flutter gen-l10n` from ARB files
- Missing framework localizations (e.g., `MaterialLocalizations` for 'mfe') fall back to English via `_MfeFallbackDelegate`
- Saved locale persisted in `SharedPreferences`; restored on app start
- Accessible via `AppLocalizations.of(context).labelKey`

**Coverage:** Nav labels, buttons, common screen strings are localized; most dialog text remains English.

---

## Theme System

**Two built-in themes:**
1. Light — bright canvas, dark text
2. Dark — dark canvas, light text

**Implementation:**
- `GuardianColors` — semantic color constants (safe, danger, warning, accent, textPrimary, textSecondary, canvas, surface, etc.)
- `buildGuardianTheme()` — generates `ThemeData` with Material 3 design tokens
- Persisted to `SharedPreferences`; restored on app start
- Theme switching via `GuardianApp.setTheme()` updates `GuardianThemeScope` without rebuilding auth/navigation

---

## Key Interactions

### Linking a New Pendant

1. User taps "Link Pendant" in Account tab
2. Enters 15-digit IMEI (from label or status SMS `ts#`)
3. App calls `DeviceService.linkPendant(imei)`
   - Validates IMEI format (canonicalizes to 15-digit)
   - Adds to user's `linkedImeis` array
4. Gateway detects new link, creates `devices/{imei}` doc on first connection
5. Dashboard shows Dodo linking animation (5 scenes)
6. Once location arrives, map updates and Dodo transitions to "live" state

### Sending SOS

1. User presses SOS button on dashboard bottom bar
2. Calls `MapDashboardPageState.sendHelpFromNavigation()`
3. Switches to Dashboard tab, shows confirmation
4. `AlertService.sendHelpAlert(imei, deviceName)` creates alert doc
5. Gateway receives alert, sends SMS/WhatsApp to emergency contacts
6. Push notification sent to all family members on app

### Creating a Safe Zone

1. User taps "Add Zone" on Safe Zones tab
2. Modal dialog:
   - Select device
   - Enter name, radius, optional WiFi SSID
   - Tap "Pick on map" or use current location
3. Submit calls `GeofenceService.create(...)`
4. Firestore adds doc to `geofences` collection
5. Gateway evaluates entrance/exit; sends alerts if enabled
6. Safe Zone card appears in list; toggle active/off

### Accepting a Family Invite

1. Family member shares 6-char code (from Account tab "Create Invite")
2. User opens Account tab, taps "Join Family"
3. Enters code → app calls `FamilyService.acceptInvite(code)`
4. Firestore marks invite as accepted; updates acceptor's `linkedImeis` with inviter's devices
5. **Known limitation:** Inviter's `familyMembers` list is NOT auto-updated (issue #62)

---

## Important Limitations & Known Issues

| Issue | Impact | Status |
|-------|--------|--------|
| **No real device onboarding** | Every new account auto-links to demo IMEI | Workaround: manual link via Account tab |
| **WiFi geofence disabled** | GT06 decoder never populates SSID field | Gateway has logic, app has UI, but no real device data |
| **Family invite one-way** | Acceptor links to inviter's devices, but inviter not notified | Issue #62 — not blocking core features |
| **No payment processor** | Subscription tier is display-only (free/premium) | Requires Stripe/Play Billing integration |
| **Partial localization** | Most dialog text in English only | Acceptable for MVP |
| **Gateway must be public** | Currently localhost only; real pendant can't reach it | Dev limitation; needs tunnel or hosting |
| **"Listen in" has no privacy indicator** | Wearer doesn't see when being monitored | Known consent gap; not yet addressed |
| **Location history requires env var** | `WRITE_LOCATION_HISTORY=true` on gateway; default false | Journey replay empty unless enabled |

---

## Testing

### Test Coverage

- **Unit tests:** Services layer tests with `fake_cloud_firestore` + `firebase_auth_mocks`
- **Widget tests:** Dashboard, safe zones, alerts, account screens
- **Run tests:** `flutter test`
- **Lint check:** `flutter analyze`

### Manual Testing

**Simulator:**
```bash
flutter run -d chrome              # Web
flutter run -d emulator-5554       # Android
```

**Mock Gateway:**
```bash
cd gateway && npm run simulate     # Fake pendant near Quatre Bornes
```

---

## Debugging Tips

### Common Issues

| Problem | Solution |
|---------|----------|
| **Linked devices not showing** | Check `linkedImeis` in Firestore `users/{uid}` doc |
| **Alerts never arrive** | Verify gateway is writing to `alerts` collection; check FCM token in logs |
| **Map won't load** | Google Maps API key missing from `google_maps_flutter` config |
| **Geofences not triggering** | Ensure `active=true`; check gateway geofence evaluation in `gateway/src/geofence.js` |
| **Journey history empty** | Set `WRITE_LOCATION_HISTORY=true` on gateway; restart |
| **Firestore composite index error** | Deploy missing index: `firebase deploy --only firestore:indexes` |

### Browser DevTools

- Console logs via `debugPrint()`
- Network requests visible in Chrome DevTools for Firestore calls
- Dart Devtools: `flutter pub global run devtools`

---

## File Reference

### Screen Files
- `screens/map_dashboard_page.dart` — Dashboard (1000+ lines, complex state)
- `screens/safe_zones_page.dart` — Safe zones CRUD
- `screens/alerts_page.dart` — Alert list
- `screens/account_page.dart` — Settings, device link, family
- `screens/care_settings_page.dart` — Fall detection, reminders (V46+)
- `screens/emergency_contacts_page.dart` — Emergency number management
- `screens/login_page.dart` — Auth (email, Google Sign-In)
- `screens/auth_gate.dart` — Auth state routing
- `screens/journey_page.dart` — Journey replay & history
- `screens/home_shell.dart` — Tab navigation container
- `screens/location_picker_page.dart` — Map center picker for zones

### Service Files
- `services/guardian_services.dart` — All Firestore CRUD (900+ lines)
- `services/auth_service.dart` — Firebase Auth, profile setup
- `services/push_service.dart` — FCM registration, local notifications
- `services/device_avatar_service.dart` — Device photo upload/cache
- `services/guardian_avatar_service.dart` — Guardian (user) photo
- `services/theme_service.dart` — SharedPreferences theme persistence
- `services/locale_service.dart` — Locale persistence
- `services/imei_utils.dart` — IMEI validation & normalization

### Widget Directories
- `widgets/dashboard/dodo_stage.dart` — Dodo character states
- `widgets/dashboard/family_device_strip.dart` — Device card UI
- `widgets/dashboard/reconnecting_pulse.dart` — Linking animation
- `widgets/map/guardian_map_presentation.dart` — Google Maps wrapper
- `widgets/safe_zones/safe_zone_card.dart` — Zone list item
- `widgets/navigation/guardian_navigation.dart` — Bottom bar

### Theme & UI
- `theme/app_theme.dart` — Color palette, typography
- `widgets/cards/guardian_card.dart` — Reusable card container
- `widgets/layout/guardian_app_header.dart` — Top bar with logo
- `widgets/layout/guardian_page_frame.dart` — Page scaffolding

---

## Related Documentation

- **FLUTTER_SETUP.md** — One-time setup (Firebase config, emulator)
- **FIREBASE_SETUP.md** — Firebase project creation
- **Gateway (gateway/src/)** — Backend that receives pendant data, evaluates geofences, sends commands
- **Firestore SCHEMA.md** — Authoritative data model; update before schema changes
- **firestore/rules.example** — Security rules; deployed via `firebase.json`

---

## Future Enhancements (From Issues)

- Real device onboarding flow (issue #27)
- Remote photo capture (issue #28) — requires vendor command verification
- Pedometer/step counter (issue #12) — requires vendor command
- Pill reminder on-device indication (issue #29)
- WiFi geofence matching (requires GT06 SSID decoding in gateway)
- Payment/subscription processor (Stripe, Play Billing)
- Full localization (all strings to ARB)
- iOS target (requires Flutter iOS setup, Apple provisioning profiles)

# Push Notifications & Alerts

**Last updated:** 2026-07-29

Guardian uses Firebase Cloud Messaging (FCM) to send real-time alerts to guardians' mobile devices, with Twilio integration for SMS/WhatsApp fallback to emergency contacts. This document covers the complete notification pipeline from event detection through delivery.

## Table of Contents

1. [Overview](#overview)
2. [FCM Architecture](#fcm-architecture)
3. [Alert Types & Triggers](#alert-types--triggers)
4. [Notification Routing](#notification-routing)
5. [App-Side Handling](#app-side-handling)
6. [Badge, Sound, and Vibration](#badge-sound-and-vibration)
7. [Deep Linking to Map](#deep-linking-to-map)
8. [Twilio Integration](#twilio-integration)
9. [Notification Logs & Monitoring](#notification-logs--monitoring)
10. [Configuration](#configuration)

---

## Overview

The notification system has three layers:

```
Event (location update, alarm, geofence) detected by gateway
    │
    ├─► Gateway creates alert in Firestore with notifyStatus='pending'
    │
    ├─► Notification rules evaluate type (SOS, fall, geofence, battery)
    │
    ├─► Push notifications sent to guardians via FCM
    │   (via gateway/src/push.js: notifyGuardianDevices)
    │
    └─► SMS/WhatsApp sent to emergency contacts (urgent alerts only)
        (via gateway/src/notify.js: notifyEmergencyContacts)
```

**Key principle:** Guardians (linked users) get push notifications for all alert types. Emergency contacts (phone numbers) get only urgent alerts (SOS, fall, geofence exit) via SMS/WhatsApp.

---

## FCM Architecture

Firebase Cloud Messaging (FCM) is Google's cloud-to-device messaging service. Guardian uses the Admin SDK on the backend to send multicast notifications to multiple devices per user.

### FCM Token Lifecycle

1. **On app launch (`apps/mobile/lib/services/push_service.dart`):**
   - Request user permission for notifications (alert, badge, sound)
   - Call `FirebaseMessaging.instance.getToken()`
   - Store the token in Firestore at `users/{uid}/fcmTokens[]` (array)
   - Set up listener for token refresh: `messaging.onTokenRefresh.listen()`

2. **Token refresh:**
   - When FCM rotates a token (usually annually, or after OS updates), the refresh listener fires
   - The new token is appended to `users/{uid}/fcmTokens[]`
   - Old tokens remain until FCM reports them invalid

3. **On sign-out:**
   - Retrieve the current token
   - Remove it from `users/{uid}/fcmTokens[]`

4. **Token pruning (gateway):**
   - After sending, if FCM responds with `messaging/registration-token-not-registered` or `messaging/invalid-registration-token`, the gateway automatically removes that token from the user's array
   - This keeps the token list clean

### Message Structure

When the gateway sends a notification via `admin.messaging().sendEachForMulticast(message)`, it includes:

```javascript
{
  notification: {
    title: "SOS alert",           // e.g., "SOS alert", "Left safe zone", "Possible fall detected"
    body: "Device 123456789..."   // Human-readable alert message or device IMEI
  },
  data: {
    imei: "123456789",            // Device IMEI (for routing to the correct pendant)
    type: "sos"                   // Alert type: sos, fall, geofence_exit, geofence_enter, low_battery, offline
  },
  tokens: [...]                   // Array of FCM tokens to send to
}
```

**Notification vs. Data payload:**
- `notification`: Rendered by the system tray when the app is backgrounded. Title and body are user-visible.
- `data`: Custom key-value pairs passed to the app. Used for routing and deep linking.

---

## Alert Types & Triggers

### Alert Types Sent to Guardians (via Push)

Defined in `gateway/src/firestore.js`, function `shouldNotify()`:

| Type | Trigger | Severity | Description |
|------|---------|----------|-------------|
| **sos** | User presses SOS button on pendant | critical | Emergency alarm. Also SMS/WhatsApp to emergency contacts. |
| **fall** | Pendant detects accelerometer event (free-fall pattern) | critical | Possible fall. Also SMS/WhatsApp to emergency contacts. |
| **geofence_exit** | Device leaves a defined safe zone | warning | Wearer left safe area (home, school, etc). Also SMS/WhatsApp to emergency contacts. |
| **geofence_enter** | Device enters a defined safe zone | info | Wearer entered a safe area. Push only (no SMS/WhatsApp). |
| **low_battery** | Pendant battery ≤ 20% | warning | Charge pendant soon. Push only. |
| **offline** | Device has no heartbeat for > 2 hours | critical | Pendant not reachable; may have lost power or signal. Push only. |

### Alert Types NOT Sent to Guardians

- `online` — Device came online (not a user alert)
- `command_response` — Device responded to a gateway command (internal)

### Alert Creation Pipeline

```
Event detected by gateway
  (location update from GT06 decoder,
   accelerometer alarm packet,
   geofence transition,
   battery check,
   offline timeout)
    │
    ▼
Create document in Firestore:
  alerts/{alertId}: {
    imei: "...",
    type: "sos" | "fall" | "geofence_exit" | etc.
    message: "...",
    severity: "info" | "warning" | "critical",
    title: "...",
    payload: { ... },
    notifyStatus: "pending",  ← triggers notification pipeline
    createdAt: server_timestamp()
  }
    │
    ▼
Pending alert watcher (firestore.js line 293)
detects new alert or status change
    │
    ▼
deliverAlertNotifications() checks type
  ├─► If shouldNotify(alert): send via FCM to guardians
  ├─► If shouldSms(alert): also send SMS/WhatsApp to emergency contacts
  └─► Update alert.notifyStatus to "sending" → "sent" → "failed"
```

### Geofence Transitions

Geofence enter/exit alerts are evaluated in real-time as location updates arrive:

1. **Load active geofences** for the IMEI from Firestore
2. **Calculate distance** from device location to each geofence center (Haversine formula)
3. **Check WiFi match** (currently unused; GT06 decoder doesn't populate WiFi SSID)
4. **State transition:**
   - First sample: seed state, don't alert
   - State change (inside → outside or vice versa): emit alert (with 60-second cooldown per geofence/direction)
5. **Create alert** and route through notification pipeline

**Cooldown:** Each `(imei, geofence, direction)` pair has a 60-second cooldown to avoid flapping alerts if the device bounces on a zone boundary.

---

## Notification Routing

### Flow for Guardians (Push)

```
gateway/src/firestore.js :: deliverAlertNotifications()
  │
  ├─► Check: shouldNotify(alert)?
  │   (type ∈ [sos, fall, geofence_exit, geofence_enter, low_battery, offline])
  │
  ├─► Claim alert for exclusive delivery:
  │   BEGIN TRANSACTION
  │     If alert.notifyStatus ≠ 'pending': abort (already claimed)
  │     SET alert.notifyStatus = 'sending'
  │   COMMIT
  │   (ensures exactly-once delivery if multiple gateways run)
  │
  ├─► Call notifyGuardianDevices(db, imei, alert)
  │   via gateway/src/push.js
  │   │
  │   ├─► Query: Find users where linkedImeis contains imei
  │   │    For each user, collect their fcmTokens[]
  │   │
  │   ├─► Group tokens for multicast send
  │   │
  │   ├─► Call admin.messaging().sendEachForMulticast({
  │   │      notification: { title, body },
  │   │      data: { imei, type },
  │   │      tokens: [...]
  │   │    })
  │   │
  │   └─► For each failed token:
  │        If error code ∈ [registration-token-not-registered, invalid-registration-token]:
  │          Prune it: arrayRemove from users/{uid}.fcmTokens
  │
  ├─► Update alert in Firestore:
  │   alert.notifyStatus = 'sent' (or 'failed')
  │   alert.notifiedAt = server_timestamp()
  │
  └─► Log summary: sent=N failed=M pruned=P
```

### Flow for Emergency Contacts (SMS/WhatsApp)

```
gateway/src/firestore.js :: deliverAlertNotifications()
  │
  ├─► Check: shouldSms(alert)?
  │   (type ∈ [sos, fall, geofence_exit])
  │
  └─► Call notifyEmergencyContacts(db, imei, alert)
      via gateway/src/notify.js
      │
      ├─► Query: Find users where linkedImeis contains imei
      │    Collect emergencyContacts[] from each user
      │
      ├─► For each contact:
      │   │
      │   ├─► Format message:
      │   │   "Guardian SOS: Device left home\nDevice IMEI 862158044589653"
      │   │
      │   ├─► If NOTIFY_SMS=true and SMS configured:
      │   │   Call Twilio SMS API with phone number
      │   │
      │   └─► If NOTIFY_WHATSAPP=true and WhatsApp configured:
      │       Call Twilio WhatsApp API with phone number
      │
      ├─► Log each contact's outcome (sms=ok, whatsapp=fail, etc.)
      │
      └─► Store audit trail in notificationLogs/{logId}:
          {
            imei, alertType, message, contactCount,
            results: [{ name, phone, channels: { sms: {...}, whatsapp: {...} } }],
            createdAt
          }
```

---

## App-Side Handling

The Flutter app (Guardian) handles incoming notifications in two states:

### When App is Foreground

`apps/mobile/lib/services/push_service.dart` :: `listenForegroundMessages()`:

```dart
FirebaseMessaging.onMessage.listen((message) {
  final notification = message.notification;
  if (notification == null) return;
  
  // Show heads-up notification using flutter_local_notifications
  _localNotifications.show(
    id: notification.hashCode,
    title: notification.title,
    body: notification.body,
    notificationDetails: NotificationDetails(
      android: AndroidNotificationDetails(
        'guardian_alerts',
        'Guardian alerts',
        channelDescription: 'SOS, fall, geofence, and battery alerts for linked pendants',
        importance: Importance.high,
        priority: Priority.high,
      ),
      iOS: const DarwinNotificationDetails(),
    ),
  );
});
```

The app manually renders the notification using `flutter_local_notifications` (OS APIs don't auto-display push notifications when the app is in the foreground).

### When App is Backgrounded or Terminated

The OS automatically renders the notification from the `notification` payload in the system tray. The app doesn't need to do anything — but it must register a background handler:

```dart
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Initialize Firebase if needed (app already initialized in foreground)
  if (DefaultFirebaseOptions.isConfigured && Firebase.apps.isEmpty) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  }
}
```

This handler is kept minimal intentionally. Its only job is to ensure Firebase is ready if the notification triggers app startup from a killed state.

### Handling Notification Taps

When a user taps a notification (foreground or background), FCM delivers the `RemoteMessage` to:

```dart
FirebaseMessaging.onMessageOpenedApp.listen((message) {
  final imei = message.data['imei'];  // Extract from data payload
  final type = message.data['type'];
  
  // Route to map screen (see "Deep Linking" below)
  navigateToDeviceOnMap(imei);
});
```

This is not shown in the provided code snippet, but the pattern is standard across Firebase apps.

---

## Badge, Sound, and Vibration

### Android

**Channel Configuration (`push_service.dart`):**

```dart
const _androidChannel = AndroidNotificationChannel(
  'guardian_alerts',
  'Guardian alerts',
  description: 'SOS, fall, geofence, and battery alerts for linked pendants',
  importance: Importance.high,  // ← High importance = heads-up notification + sound
);
```

**Per-notification settings (`push_service.dart`):**

```dart
AndroidNotificationDetails(
  'guardian_alerts',
  'Guardian alerts',
  channelDescription: 'SOS, fall, geofence, and battery alerts for linked pendants',
  importance: Importance.high,      // ← Notification priority
  priority: Priority.high,           // ← Urgency for old Android versions
),
```

**Effect:**
- **Sound:** Default device notification sound (user-configured in system settings)
- **Vibration:** Default pattern from channel importance
- **Heads-up (pop-up):** Displayed because `importance: Importance.high`
- **Badge:** Incremented on the app icon (if device/launcher supports it)

### iOS

```dart
iOS: const DarwinNotificationDetails(),
```

Uses iOS defaults:
- **Sound:** System default, or muted if user silenced notifications in Settings
- **Vibration/Haptic:** Device default (varies by iPhone model)
- **Badge:** Red badge number on app icon, incremented
- **Alert:** Shown in notification center (behavior depends on iOS version)

### Firebase Console Defaults

When you send a test notification via the Firebase Console, it uses the `notification` payload from the message. The app doesn't customize sound per alert type; all alerts use the channel's defaults.

**To customize sound by alert type** (e.g., louder for SOS), you would:
1. Add a `sound` field to the Android notification details
2. Place custom audio files in `android/app/src/main/res/raw/`
3. Pass the filename (no extension) to the notification details

Example:
```dart
AndroidNotificationDetails(
  'guardian_alerts',
  'Guardian alerts',
  sound: RawResourceAndroidNotificationSound('alert_sos'),  // Plays android/app/src/main/res/raw/alert_sos.mp3
  importance: Importance.high,
  priority: Priority.high,
),
```

---

## Deep Linking to Map

When a user taps a notification, the app should navigate to the map screen for the device that sent the alert.

### Current Implementation Status

**Note:** Deep linking for notifications is not fully implemented in the provided code. The following describes the intended architecture.

### Intended Flow

1. **Notification tapped** → Firebase delivers `RemoteMessage` to app via `onMessageOpenedApp`

2. **Extract IMEI** from message data:
   ```dart
   final message = RemoteMessage(...);
   final imei = message.data['imei'];  // Gateway includes this in data payload
   ```

3. **Navigate to device map:**
   ```dart
   // Pseudo-code; exact implementation depends on your router
   context.go('/map?deviceImei=$imei');
   // or if using GetX:
   Get.toNamed('/map', arguments: {'deviceImei': imei});
   ```

4. **Map screen loads device** and centers on its current location

### Message Data Payload

The gateway includes enough context in the `data` field:
```javascript
data: {
  imei: "862158044589653",
  type: "sos"  // or "fall", "geofence_exit", etc.
}
```

The app can use `imei` to query Firestore for the device's current location and zoom to it.

### Example Implementation

```dart
// In main.dart or router setup:
FirebaseMessaging.onMessageOpenedApp.listen((message) {
  final imei = message.data['imei'];
  if (imei != null) {
    // Navigate to map with this device in focus
    AppRouter.instance.push(MapRoute(focusImei: imei));
  }
});
```

```dart
// In map_screen.dart:
class MapScreen extends StatefulWidget {
  final String? focusImei;
  const MapScreen({this.focusImei});
  
  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  @override
  void initState() {
    super.initState();
    if (widget.focusImei != null) {
      // Animate camera to device location
      _animateCameraToDevice(widget.focusImei!);
    }
  }
  
  Future<void> _animateCameraToDevice(String imei) async {
    final device = await _deviceService.getDevice(imei);
    if (device?.location != null) {
      _mapController.animateCamera(
        CameraUpdateOptions(
          bounds: CameraUpdateBounds(
            bounds: LatLngBounds(
              southwest: LatLng(device.location.lat - 0.01, device.location.lng - 0.01),
              northeast: LatLng(device.location.lat + 0.01, device.location.lng + 0.01),
            ),
          ),
        ),
      );
    }
  }
}
```

---

## Twilio Integration

Guardian uses Twilio to send SMS and WhatsApp messages to emergency contacts for urgent alerts (SOS, fall, geofence exit).

### Configuration

**Environment variables** (in `gateway/.env`):

```env
# Twilio account credentials
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=auth_token_here

# Twilio phone numbers for SMS and WhatsApp
TWILIO_FROM_SMS=+12025551234        # SMS sender number (US-based)
TWILIO_WHATSAPP_FROM=whatsapp:+12025551234  # WhatsApp sender number

# Feature flags
NOTIFY_SMS=true                     # Send SMS to emergency contacts
NOTIFY_WHATSAPP=true                # Send WhatsApp to emergency contacts
```

### How It Works

**Flow in `gateway/src/notify.js`:**

1. **Find emergency contacts:**
   ```javascript
   // Query: users where linkedImeis contains imei
   // Collect emergencyContacts[] from each
   contacts = [
     { name: "Mom", phone: "+230 5 5555555", whatsapp: "+230 5 5555555" },
     { name: "Dad", phone: "+230 5 4444444", whatsapp: null }
   ]
   ```

2. **Format message:**
   ```javascript
   buildMessage(imei, alert)
   // Returns: "Guardian SOS: Device pressed emergency button\nDevice IMEI 862158044589653"
   ```

3. **Send via Twilio:**
   ```javascript
   // SMS:
   POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
   Body:
     To: +230 5 5555555 (normalized to E.164)
     From: +12025551234
     Body: "Guardian SOS: ..."
   
   // WhatsApp:
   POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
   Body:
     To: whatsapp:+230 5 5555555
     From: whatsapp:+12025551234
     Body: "Guardian SOS: ..."
   ```

4. **Phone number normalization (`gateway/src/notify.js`):**
   ```javascript
   normalizeE164(phone)
   // "+230 5 5555555" → "+230 5 5555555"
   // "5 5555555" (Mauritius local) → "+230 5 5555555"
   // "50005555555" → "+50005555555"
   ```

### Message Examples

**SOS alert:**
```
Guardian SOS: User pressed emergency button
Device IMEI 862158044589653
```

**Fall alert:**
```
Guardian Possible fall detected: Wearer may have fallen
Device IMEI 862158044589653
```

**Geofence exit:**
```
Guardian Geofence exit: Left safe zone (Home)
Device IMEI 862158044589653
```

### Audit Logging

Every SMS/WhatsApp send attempt (success or failure) is logged to Firestore:

```javascript
notificationLogs/{logId}: {
  imei: "862158044589653",
  alertType: "sos",
  message: "Guardian SOS: ...",
  contactCount: 2,
  results: [
    {
      name: "Mom",
      phone: "+230 5 5555555",
      channels: {
        sms: { ok: true, body: "..." },
        whatsapp: { ok: false, skipped: true, reason: "NOTIFY_WHATSAPP=false" }
      }
    },
    {
      name: "Dad",
      phone: "+230 5 4444444",
      channels: {
        sms: { ok: true, body: "..." },
        whatsapp: { ok: false, status: 429, body: "Rate limited" }
      }
    }
  ],
  createdAt: server_timestamp()
}
```

Each channel result includes:
- `ok: boolean` — Did the send succeed?
- `skipped: boolean` — Was sending skipped (feature disabled)?
- `reason: string` — Why was it skipped? ("NOTIFY_SMS=false", "TWILIO_FROM_SMS missing", etc.)
- `status: number` — HTTP status code (on error)
- `body: string` — Response body (truncated to 120 chars)

### Limitations & Costs

1. **Twilio costs money** per SMS (~$0.0075) and per WhatsApp (~$0.01–0.05 depending on template)
2. **SMS delivery is not guaranteed** (depends on carrier)
3. **WhatsApp requires opt-in** — Contacts must have previously messaged your Twilio number, or you use a pre-approved template
4. **Rate limiting** — Twilio throttles requests if sending too fast to the same number
5. **Regional restrictions** — Some countries block SMS/WhatsApp gateways
6. **Phone number validation** — Twilio validates phone numbers per region; invalid numbers fail silently

---

## Notification Logs & Monitoring

### Firestore Collections

**`alerts`** — Created by the gateway when an event is detected:

```
{
  imei: "862158044589653",
  type: "sos" | "fall" | "geofence_exit" | etc.,
  message: "...",
  severity: "info" | "warning" | "critical",
  title: "...",
  payload: { ... },
  notifyStatus: "pending" | "sending" | "sent" | "failed",
  notifyError: "...",      // (if failed)
  notifiedAt: server_timestamp(),
  resolved: false,
  resolvedAt: null,
  createdAt: server_timestamp()
}
```

**`notificationLogs`** — Created after attempting SMS/WhatsApp to emergency contacts (see section above).

### Querying Alerts

```javascript
// Get recent alerts for a device
db.collection('alerts')
  .where('imei', '==', imei)
  .orderBy('createdAt', 'desc')
  .limit(50)
  .get();

// Get alerts that failed to deliver
db.collection('alerts')
  .where('notifyStatus', '==', 'failed')
  .orderBy('createdAt', 'desc')
  .get();

// Get critical alerts
db.collection('alerts')
  .where('severity', '==', 'critical')
  .orderBy('createdAt', 'desc')
  .get();
```

**Note:** These queries require composite indexes in Firestore. See `firestore/firestore.indexes.json` for defined indexes.

### Gateway Logs

The gateway logs notification delivery to console:

```
[push] 862158044589653 sent=2 failed=0 pruned=1
[notify] Mom +230 5 5555555 sms=ok whatsapp=fail
[notify] Dad +230 5 4444444 sms=ok whatsapp=ok
```

---

## Configuration

### Backend (Gateway)

**File:** `gateway/.env` (not checked in; use `.env.example` as template)

| Variable | Purpose | Example |
|----------|---------|---------|
| `FIREBASE_PROJECT_ID` | Firebase project for Firestore & FCM | `guardian-prod` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Firebase service account JSON | `/etc/guardian/sa.json` |
| `WRITE_LOCATION_HISTORY` | Store location history in Firestore | `true` |
| `NOTIFY_SMS` | Enable SMS to emergency contacts | `true` |
| `NOTIFY_WHATSAPP` | Enable WhatsApp to emergency contacts | `true` |
| `TWILIO_ACCOUNT_SID` | Twilio account ID | `ACxxxxxxxx` |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | `token_here` |
| `TWILIO_FROM_SMS` | SMS sender phone number | `+12025551234` |
| `TWILIO_WHATSAPP_FROM` | WhatsApp sender phone number | `+12025551234` |

### Mobile (Flutter)

**Firebase Setup:**

1. **Android:**
   - Add Firebase credentials to `android/app/google-services.json`
   - Enable FCM in Firebase Console
   - Request notification permission at runtime (Android 13+)

2. **iOS:**
   - Add Firebase credentials to `ios/Pods/Firebase/GoogleService-Info.plist`
   - Enable push notifications in Xcode: Signing & Capabilities → Push Notifications
   - Upload APNs certificate to Firebase Console

**Code:**

```dart
// In main.dart or app initialization:
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await PushService.initLocalNotifications();
  PushService.listenForegroundMessages();
  runApp(const MyApp());
}

// After user signs in:
final authService = AuthService();
await authService.signIn(email, password);
final userId = authService.currentUser?.uid;
if (userId != null) {
  await PushService().registerForUser(userId);
}

// After user signs out:
final userId = authService.currentUser?.uid;
if (userId != null) {
  await PushService().unregisterForUser(userId);
}
```

---

## Troubleshooting

### Notifications Not Arriving

1. **Is the app installed and permissions granted?**
   - Android: Settings → Apps → Guardian → Notifications → Allow
   - iOS: Settings → Notifications → Guardian → Allow Notifications

2. **Check FCM token registration:**
   ```javascript
   db.collection('users').doc(uid).get()
     .then(doc => console.log(doc.data().fcmTokens));
   ```
   If empty, the user hasn't granted permission or PushService.registerForUser() wasn't called.

3. **Is Firestore enabled in the gateway?**
   - Check `FIRESTORE_DISABLED` env var (should be unset or `false`)
   - Check service account permissions (needs `firestore.databases.update`, `firestore.documents.create`)

4. **Are you running the gateway?**
   - Notifications are delivered asynchronously after the gateway creates an alert
   - If the gateway is stopped, alerts pile up in Firestore with `notifyStatus='pending'`

5. **Check alert `notifyStatus`:**
   ```javascript
   db.collection('alerts').where('notifyStatus', '==', 'failed').get()
   ```
   If alerts are stuck in `'failed'`, check the gateway logs for error messages.

### Twilio SMS/WhatsApp Not Delivering

1. **Is Twilio configured?**
   ```javascript
   // In gateway terminal:
   console.log(process.env.TWILIO_ACCOUNT_SID);
   console.log(process.env.TWILIO_FROM_SMS);
   ```

2. **Check emergency contact phone numbers:**
   ```javascript
   db.collection('users').doc(uid).get()
     .then(doc => console.log(doc.data().emergencyContacts));
   ```

3. **Check notificationLogs:**
   ```javascript
   db.collection('notificationLogs')
     .orderBy('createdAt', 'desc')
     .limit(10)
     .get();
   ```
   Look for failed sends in the results.

4. **Is the phone number in the correct format?**
   - Mauritius: `+230 5 XXXXXXX` or local format `5 XXXXXXX`
   - The `normalizeE164()` function converts local numbers to `+230 5 XXXXXXX`

5. **Twilio rate limiting:**
   - If sending many alerts quickly, Twilio may reject requests
   - Check HTTP status code in notificationLogs (429 = rate limited)

---

## See Also

- `docs/04-gateway/EVENT_PROCESSING.md` — Alert creation triggers
- `docs/04-gateway/GATEWAY_OVERVIEW.md` — Full gateway architecture
- `gateway/src/push.js` — FCM multicast implementation
- `gateway/src/notify.js` — Twilio SMS/WhatsApp implementation
- `apps/mobile/lib/services/push_service.dart` — Flutter FCM setup
- `firestore/SCHEMA.md` — Data model for alerts and users

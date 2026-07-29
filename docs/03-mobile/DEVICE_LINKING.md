# Device Linking Workflow

**Last updated:** 2026-07-29

Complete technical guide to how the Guardian mobile app links a pendant to a guardian account, including IMEI entry, validation, Firestore persistence, and real-time progress feedback.

## Overview

Device linking is the process of associating a physical V28C/V46/V48/V52 pendant with a guardian's account so the app can display its location, receive alerts, and send commands. The workflow has three phases:

1. **Guardian Input** — User enters 15-digit IMEI in a dialog
2. **Validation & Firestore Write** — Client validates format and adds IMEI to `users/{uid}.linkedImeis`
3. **Real-time Progress (Dodo)** — Dashboard monitors gateway connection states and displays 4-step linking progression

## Phase 1: IMEI Entry Screen

### UI Location
Accessed from Account page via a "Link a pendant" button. Shows an `AlertDialog` with:
- Explanatory text: "Enter the 15-digit IMEI printed on the pendant or returned by the status SMS (ts#)."
- Text input field (number keyboard, max 15 characters)
- Example placeholder: "e.g. 861397053141170"
- Cancel and Link action buttons

### Example Implementation
See `apps/mobile/lib/screens/account_page.dart:_linkPendant()`:

```dart
Future<void> _linkPendant(BuildContext context) async {
  final ctrl = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Link a pendant'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Enter the 15-digit IMEI printed on the pendant or returned '
            'by the status SMS (ts#).',
          ),
          // TextField with keyboardType: TextInputType.number
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Link')),
      ],
    ),
  );
}
```

## Phase 2: Validation & Firestore Write

### IMEI Formats & Normalization

The app accepts two IMEI formats and normalizes both to a canonical 15-digit Firestore document ID:

#### Full IMEI (15 digits)
- **Format:** e.g., `861397053141170`
- **Source:** Printed on pendant label, returned by status SMS (`ts#` command)
- **Validation:** Exactly 15 digits, all numeric
- **Used in Firestore:** As-is, document ID for `devices/{imei}`

#### Protocol ID (10 digits, V28C only)
- **Format:** e.g., `9701411170`
- **Source:** Low-level protocol packets
- **Validation:** Exactly 10 digits, starts with `970`, all numeric
- **Conversion to Full IMEI:**
  ```
  Protocol ID: 9701411170
  → Prefix:    8613970 + remaining digits (1411170)
  → Result:    861397053141170 (padding to 15 digits)
  ```

### Validation Logic

Located in `apps/mobile/lib/services/imei_utils.dart`:

```dart
bool isFullImei(String value) {
  final id = _digitsOnly(value);
  return id.length == 15 && RegExp(r'^\d+$').hasMatch(id);
}

String? canonicalDeviceImei(String raw) {
  final id = _digitsOnly(raw);
  if (id.isEmpty) return null;
  if (isFullImei(id)) return id;
  if (isProtocolId(id)) return fullImeiFromProtocolId(id) ?? id;
  return id;
}
```

### Firestore Write

Once validated, the app updates the signed-in user's document:

**Location:** `users/{uid}` (Firebase Auth UID as doc ID)  
**Operation:** Merge update  
**Fields Modified:**
- `linkedImeis` (array) — Add canonical IMEI via `FieldValue.arrayUnion()`
- `updatedAt` — Server timestamp

**Code** (from `apps/mobile/lib/services/guardian_services.dart:linkPendant()`):

```dart
Future<void> linkPendant(String rawImei) async {
  final user = _auth.currentUser;
  if (user == null) throw StateError('Not signed in');

  final imei = canonicalDeviceImei(rawImei.trim());
  if (imei == null || !isFullImei(imei)) {
    throw StateError('Enter the 15-digit IMEI from the pendant label or status SMS');
  }

  await _db.collection('users').doc(user.uid).set({
    'linkedImeis': FieldValue.arrayUnion([imei]),
    'updatedAt': FieldValue.serverTimestamp(),
  }, SetOptions(merge: true));
}
```

### User Feedback (Phase 2)

On success: `SnackBar` — "Pendant linked — it will appear when the gateway receives data"

On error:
- **Invalid format:** "Enter the 15-digit IMEI from the pendant label or status SMS"
- **Not signed in:** "Not signed in"
- **Firestore error:** "Could not link pendant: {error}"

## Phase 3: Real-Time Progress (Dodo)

Once the IMEI is in `linkedImeis`, the app streams the device document from Firestore. A special "Dodo" UI narrative tracks the pendant's connection state through four progress stages displayed on the dashboard.

### The 4 Steps

The progression is determined by device connection state fields and location availability:

| Step | Name | Indicator | What's Happening | Duration | Icon |
|------|------|-----------|------------------|----------|------|
| 0 | **Pendant Awake** | `connectionState: 'connecting'` (recent) | TCP handshake initiated; gateway sent login response | ~0–5s | 🛏️ `bedtime_outlined` → 📡 `sensors_rounded` |
| 1 | **Network Ready** | Session active; no location yet | TCP secure, pendant authenticated | ~5–30s | 🔒 `lock_outline_rounded` |
| 2 | **Location Found** | First location + session active | GPS/WiFi/cell fix acquired | ~10–60s+ | 📍 `gps_fixed_rounded` or 🧭 `explore_outlined` |
| 3 | **Guardian AI Ready** | Fresh location + intelligence computed | AI insights available | ~60s+ | ✨ `auto_awesome_rounded` |

**Source Code:** `apps/mobile/lib/dashboard/linking_story.dart:linkingStoryStep()`

### State Machine

```
Device created with emptylinkedImeis
    │
    ├─► User enters IMEI
    │
    ├─► Firestore: linkedImeis.add(imei)
    │
    ├─► App watches devices/{imei}
    │
    ├─► Gateway receives first TCP packet
    │   • Sets: connectionState = 'connecting', connectingAt = now
    │
    ├─► Step 0: Pendant Awake
    │   • Duration: 0–5 sec
    │   • User sees: "Waking {name}" / "Checking pendant"
    │   • Icon pulses between 🛏️ and 📡
    │
    ├─► Gateway receives heartbeat/status
    │   • Confirms: session active, not just TCP open
    │
    ├─► Step 1: Network Ready
    │   • Duration: 5–30 sec from TCP connect
    │   • User sees: "Securing link" / "Making contact"
    │   • Icon: 🔒 (lock)
    │
    ├─► Gateway receives location (GPS, WiFi, or cell)
    │   • Persists: location data, accuracySource
    │
    ├─► Step 2: Location Found
    │   • Duration: 10–60+ sec from TCP connect
    │   • User sees: "Finding {name}" / "Locating…" or "Approx. location"/"Precise location"
    │   • Icon: 📍 (GPS fixed) or 🧭 (approx)
    │
    ├─► Gateway computes intelligence
    │   • Evaluates geofences, trip state, anomalies
    │
    └─► Step 3: Guardian AI Ready
        • Duration: ~60+ sec from TCP connect
        • User sees: "Guardian AI ready"
        • Icon: ✨ (auto_awesome)
```

### Step Detection Logic

**Step 0 (Pendant Awake):**
```dart
device.isReconnecting && !deviceHasSessionHeartbeat(device)
```

**Step 1 (Network Ready):**
```dart
device.isReconnecting && (deviceIsHandshaking(device) || device.connectionState == 'connecting')
  && deviceHasSessionHeartbeat(device)
```

**Step 2 (Location Found):**
```dart
device.isReconnecting && deviceHasSessionHeartbeat(device) && !location.isValid
```

**Step 3 (Guardian AI Ready):**
```dart
device.isReconnecting && deviceHasSessionHeartbeat(device) && location.isValid && fresh
```

### User-Facing Messages

The app rotates reassuring messages every 6 seconds (`linkingMessageHold`), tailored to each step:

#### Step 0 (Pendant Waking)
**Titles:**
- "Hi — I'm checking on {name}."
- "Let's see how {name} is doing."
- "One moment while I wake the pendant…"

**Details:**
- "The pendant has just come on."
- "Waking things up gently…"
- "Making sure everything is ready…"
- "Connecting to Guardian…"

#### Step 1 (Network Linking)
**Titles:**
- "I can hear {name}'s pendant."
- "Getting a secure connection ready…"
- "Signal looks good so far."

**Details:**
- "Linking up with the pendant now."
- "This usually only takes a moment."
- "Stay with me — we're getting there."

#### Step 2 (Location Waiting)
**Titles:**
- "Looking for {name}…"
- "Finding the best location signal…"
- "Still waiting for the first location…"

**Details:**
- "Location can take a few moments, especially indoors."
- "Searching for a clear signal nearby…"
- "Hang tight — a location update is on the way."
- *(If elapsed ≥ 20s):* "Indoors can take a bit longer. Hang tight."
- *(If elapsed ≥ 40s):* "Still working on it. Nothing to worry about."
- *(If elapsed ≥ 60s):* "We're connected — just waiting for a clear location."
- *(If elapsed ≥ 90s):* "This can take a little while after power-on. I'm still here with you."

#### Step 3 (Guardian AI Ready)
**Titles:**
- "Almost there!"
- "Everything looks good so far."
- "Preparing the first location update…"

**Details:**
- "Connection looks solid — finishing up now."
- "Almost ready to show you where {name} is."
- "Good news is coming…"

### Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DEVICE LINKING WORKFLOW                          │
└─────────────────────────────────────────────────────────────────────────┘

USER SIDE (Mobile App)
═════════════════════════════════════════════════════════════════════════════

1. Account Screen
   └─► Tap "Link a pendant"
       │
       ▼
2. IMEI Input Dialog
   ├─ Instructions: "Enter 15-digit IMEI"
   ├─ Input field (max 15 chars, numeric keyboard)
   ├─ Example: "861397053141170"
   │
   ├─ CANCEL ──► Dismiss
   │
   └─ LINK ──► Validate & Write

3. Validation
   ├─ Check format: 15 digits (or 10-digit protocol ID)
   ├─ Normalize: canonicalDeviceImei()
   │
   ├─ INVALID ──► Error SnackBar
   │               "Enter the 15-digit IMEI from the pendant label or status SMS"
   │
   └─ VALID ──► Firestore Write

4. Firestore Write
   ├─ Update: users/{uid}.linkedImeis += [imei]
   │
   ├─ FAILURE ──► Error SnackBar
   │               "Could not link pendant: {error}"
   │
   └─ SUCCESS ──► Success SnackBar
                  "Pendant linked — it will appear when the gateway receives data"

5. Dashboard Watches Device Document
   ├─ Stream: devices/{imei}
   │
   └─► Real-time progress shown via Dodo (see below)

═════════════════════════════════════════════════════════════════════════════

GATEWAY SIDE (TCP Server)
═════════════════════════════════════════════════════════════════════════════

Step 0: TCP Connect (0–5 sec)
   Pendant opens TCP connection
   │
   ├─ Parse first packet (login/handshake)
   ├─ Extract: protocol ID (10 digits)
   ├─ Normalize: → 15-digit IMEI
   │
   └─► Firestore Write
       • devices/{imei}.connectionState = "connecting"
       • devices/{imei}.connectingAt = now
       • devices/{imei}.online = false (not yet confirmed)

Step 1: Session Heartbeat (5–30 sec)
   Gateway receives heartbeat or status packet
   │
   ├─ Confirm: pendant is alive and responsive
   │
   └─► Firestore Write
       • devices/{imei}.lastHeartbeatAt = now
       • devices/{imei}.online = true
       • devices/{imei}.connectionState = "live"
       • devices/{imei}.connectingAt = delete (clear)

Step 2: Location Fix (10–60+ sec)
   Pendant sends GPS/WiFi/cell location
   │
   ├─ Geofence evaluation: check against safe zones
   ├─ Write gate: only write if moved ≥ 50m or first fix
   │
   └─► Firestore Write
       • devices/{imei}.location = { lat, lng, altitude?, recordedAt }
       • devices/{imei}.accuracySource = "gps" | "wifi" | "lbs"
       • Optional: devices/{imei}/locations/{id} (if history enabled)

Step 3: Guardian AI (60+ sec)
   Gateway computes device intelligence
   │
   ├─ Geofence status: inside/outside safe zones
   ├─ Trip detection: stationary/moving
   ├─ Battery health: normal/low
   ├─ Signal quality: strong/weak
   ├─ Stale location: yes/no
   │
   └─► Firestore Write
       • devices/{imei}.intelligence = { insights[], topInsight, updatedAt }

═════════════════════════════════════════════════════════════════════════════

APP DASHBOARD (Real-time UI)
═════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────┐
│ Step 0: Pendant Awake                                   │
├─────────────────────────────────────────────────────────┤
│ 🛏️  Waking…                     [1/4]                    │
│ 🔗 Network waiting                                       │
│ 📍 Location waiting                                      │
│ ✨ Guardian AI waiting                                   │
│                                                          │
│ "Hi — I'm checking on {name}."                          │
│ "The pendant has just come on."                         │
└─────────────────────────────────────────────────────────┘

         ↓ (5 seconds, heartbeat received)

┌─────────────────────────────────────────────────────────┐
│ Step 1: Network Ready                                   │
├─────────────────────────────────────────────────────────┤
│ ✓ Pendant awake                  [2/4]                  │
│ 🔒 Securing link                                        │
│ 📍 Location waiting                                      │
│ ✨ Guardian AI waiting                                   │
│                                                          │
│ "I can hear {name}'s pendant."                          │
│ "Linking up with the pendant now."                      │
└─────────────────────────────────────────────────────────┘

         ↓ (30 seconds, location received)

┌─────────────────────────────────────────────────────────┐
│ Step 2: Location Found                                  │
├─────────────────────────────────────────────────────────┤
│ ✓ Pendant awake                  [3/4]                  │
│ ✓ Network ready                                         │
│ 📍 Finding {name}… (or "Approx. location")             │
│ ✨ Guardian AI waiting                                   │
│                                                          │
│ "Looking for {name}…"                                  │
│ "Location can take a few moments, especially indoors." │
└─────────────────────────────────────────────────────────┘

         ↓ (60 seconds, intelligence computed)

┌─────────────────────────────────────────────────────────┐
│ Step 3: Guardian AI Ready                               │
├─────────────────────────────────────────────────────────┤
│ ✓ Pendant awake                  [4/4]                  │
│ ✓ Network ready                                         │
│ ✓ Precise location                                      │
│ ✓ Guardian AI ready                                     │
│                                                          │
│ "Almost there!"                                         │
│ "Connection looks solid — finishing up now."           │
│                                                          │
│          [Device map + details now visible]             │
└─────────────────────────────────────────────────────────┘
```

## Error Handling

### Client-Side Validation Errors

**Invalid IMEI format:**
- Error: "Enter the 15-digit IMEI from the pendant label or status SMS"
- User action: Correct the input and retry

**Not signed in:**
- Error: "Not signed in"
- User action: Re-authenticate (should not happen in normal flow)

**Empty input:**
- Handled by `canonicalDeviceImei()` returning `null`
- Error: "Enter the 15-digit IMEI from the pendant label or status SMS"

### Firestore Write Errors

**Network failure:**
- Error: "Could not link pendant: {network error}"
- User action: Retry when connectivity restored

**Permission denied:**
- Error: "Could not link pendant: {permission error}"
- User action: Check Firestore security rules; contact support if persistent

**Duplicate IMEI:**
- Handled gracefully by `arrayUnion()` — adding an IMEI already in the array is a no-op
- Success SnackBar shown (IMEI is linked, whether newly or already)

### Runtime Connection Failures

**Pendant offline during linking:**
- User sees stuck on "Step 0: Pendant Awake" with reassurance messages
- No error alert; app continues monitoring for connection
- User can dismiss and try later

**Pendant connected but no GPS fix (long delay):**
- Steps 0–1 complete quickly (~30 sec)
- Step 2 shows "Finding {name}…" or "Locating…"
- Reassurance escalates at 20s, 40s, 60s, 90s
- No timeout; user can dismiss and check back later

**Gateway temporarily unavailable:**
- Pendant still connects locally, but no Firestore updates
- App shows no device in list (Firestore empty or stale)
- User can retry linking IMEI or wait for gateway recovery

## Timing Expectations

### Typical Timeline (Pendant Waking from Sleep)

| Event | Time | Notes |
|-------|------|-------|
| User taps Link | T+0 | IMEI entered and validated |
| Firestore write | T+0–2s | Client updates `linkedImeis` |
| Gateway TCP connect | T+2–10s | Pendant wakes from sleep; link established |
| Step 0 complete | T+5–15s | First packet received; `connectionState = 'connecting'` |
| Heartbeat received | T+10–30s | Gateway confirms session; `online = true` |
| Step 1 complete | T+30–60s | First location fix (GPS/WiFi/cell) acquired |
| Step 2 complete | T+30–90s | Location persisted; displayed on map |
| Intelligence computed | T+60–120s | Geofences evaluated; insights ready |
| Step 3 complete | T+120s | Full UI ready; all metrics green |

**Variability factors:**
- **GPS cold start:** 30–120s (worse indoors or poor sky visibility)
- **WiFi fallback:** 5–30s if GPS unavailable
- **Network latency:** +10–30s if gateway not on same LAN
- **Firestore sync:** +2–5s for each operation

### Best Case (Pendant Already Warm)
- T+0 to T+30: All steps complete, full location display

### Worst Case (Pendant Cold Start, GPS Weak)
- T+0 to T+120–180: Slow progression, user sees reassurance messages throughout

## Firestore Security

Device linking respects the existing security model:

- **Read:** Guardians see `devices/{imei}` only if `imei ∈ users/{uid}.linkedImeis`
- **Write to linkedImeis:** Only the signed-in user can add to their own `linkedImeis` array
- **Device doc creation:** Gateway creates `devices/{imei}` on first pendant connection (admin SDK, not user-writable)
- **Firestore Rules:** Enforce via `linkedTo(imei)` rule — all device queries must filter by `linkedImeis`

See `firestore/rules.example` and `firestore/SCHEMA.md` for complete security reference.

## Multi-Device Linking

A single guardian can link multiple pendants:

1. Tap "Link a pendant" multiple times, entering a different IMEI each time
2. Each IMEI is added to `users/{uid}.linkedImeis` via `arrayUnion()`
3. App streams all linked devices via `DeviceService.watchLinkedDevices()`
4. Dashboard shows cards for each linked device

**Example flow:**
```
users/{uid}.linkedImeis = []
  ↓ Link device 1
users/{uid}.linkedImeis = ["861397053141170"]
  ↓ Link device 2
users/{uid}.linkedImeis = ["861397053141170", "861397053141171"]
  ↓ Link device 3
users/{uid}.linkedImeis = ["861397053141170", "861397053141171", "861397053141172"]
```

## Unlinking a Device

When a guardian no longer needs access to a device, they can unlink it via Account page:

```dart
Future<void> unlinkPendant(String rawImei) async {
  final user = _auth.currentUser;
  if (user == null) throw StateError('Not signed in');

  final imei = canonicalDeviceImei(rawImei.trim());
  if (imei == null || !isFullImei(imei)) {
    throw StateError('Invalid pendant IMEI');
  }

  await _db.collection('users').doc(user.uid).set({
    'linkedImeis': FieldValue.arrayRemove([imei]),
    'updatedAt': FieldValue.serverTimestamp(),
  }, SetOptions(merge: true));
}
```

**Effect:**
- IMEI removed from `linkedImeis` array
- Device document in Firestore remains (other guardians may be linked)
- This guardian's access revoked; app no longer streams device data
- Device appears offline/unavailable in dashboard

## Known Limitations

### No Real Onboarding Flow Yet
- Every new account is initially auto-linked to a hardcoded demo IMEI (`AuthService.demoImei = '359633100123456'`)
- Real device linking requires manual IMEI entry (design working but not deployed to all users)
- See GitHub issue for roadmap to real hardware onboarding

### No Device Discovery
- App cannot scan for nearby pendants or query a vendor database
- User must manually enter or find the IMEI on the device label or via SMS status command

### Protocol ID to Full IMEI Conversion
- The app can accept a 10-digit protocol ID but must expand it to 15 digits for Firestore
- Conversion may fail silently if protocol ID doesn't start with `970` (Firestore document still created with 10-digit ID in that case)
- Recommend always using 15-digit IMEI to avoid ambiguity

### No Duplicate-Link Prevention (UI)
- App allows re-entering the same IMEI multiple times
- Firestore `arrayUnion()` deduplicates server-side (no harm done)
- Recommend: Show warning if IMEI already in list before writing

### Linking Without Pendant Online
- App will accept and link any valid IMEI format, even if pendant is not yet connected
- Device won't appear in dashboard until gateway receives first packet
- User sees no visual feedback until pendant powers on and connects
- Consider: Show a "Device linked, waiting for first connection…" state

## Testing

### Manual Testing Checklist

- [ ] **Valid IMEI entry:** Enter `861397053141170`, confirm linked
- [ ] **Invalid format:** Enter `123`, confirm error
- [ ] **10-digit protocol ID:** Enter `9701411170`, confirm converts to `861397053141170`
- [ ] **Duplicate link:** Enter same IMEI twice, confirm success both times (no duplicate entry)
- [ ] **Firestore write:** Verify `users/{uid}.linkedImeis` array includes new IMEI
- [ ] **Device stream:** Watch dashboard for Dodo progression (if pendant connected)
- [ ] **Multiple devices:** Link 2–3 different IMEIs, confirm all appear on dashboard
- [ ] **Unlinking:** Unlink a device, confirm removed from `linkedImeis` and dashboard
- [ ] **Offline pendant:** Link an IMEI for a pendant not yet connected, confirm device doesn't appear until it connects

### Unit Test Examples

See `apps/mobile/test/imei_utils_test.dart`:
```dart
test('normalizes 15-digit IMEI as-is', () {
  expect(canonicalDeviceImei('861397053141170'), '861397053141170');
});

test('expands 10-digit protocol ID', () {
  expect(canonicalDeviceImei('9701411170'), '861397053141170');
});

test('rejects invalid formats', () {
  expect(canonicalDeviceImei('123'), isNotNull); // returns raw
  expect(isFullImei(canonicalDeviceImei('123')), false);
});
```

See `apps/mobile/test/linking_story_test.dart`:
```dart
test('returns step 0 when connecting', () {
  final device = Device(imei: '...', connectionState: 'connecting', ...);
  expect(linkingStoryStep(device), 0);
});

test('returns step 1 when session active', () {
  final device = Device(imei: '...', lastHeartbeatAt: now, ...);
  expect(linkingStoryStep(device), 1);
});
```

## Related Documentation

- **Firestore Schema:** `firestore/SCHEMA.md` — `users/{uid}.linkedImeis` field definition
- **Device Model:** `apps/mobile/lib/models/device.dart` — Device class and connection states
- **Gateway Flow:** `gateway/src/connection-handshake.js`, `gateway/src/firestore.js` — How gateway updates connection state
- **Dodo UI:** `apps/mobile/lib/dashboard/linking_story.dart` — Real-time progress metrics
- **Security Rules:** `firestore/rules.example` — `linkedTo(imei)` enforcement

## FAQ

**Q: Can I link a pendant without it being powered on?**
A: Yes, the app validates and stores the IMEI, but the device won't appear on the dashboard until the gateway receives its first packet.

**Q: What if I enter the wrong IMEI?**
A: The app only validates format, not ownership. If you link an IMEI for someone else's device, you'll see their location and device data. This is a design choice to avoid requiring vendor API calls; treat IMEI entry as a trusted action (guardian has physical access to pendant).

**Q: Why 4 steps instead of 3 (or 5)?**
A: The 4 steps align with real pendant power-on sequence: (1) CPU wakes, (2) radio/modem links, (3) GPS fixes, (4) AI processes the data. Fewer steps = less granularity for troubleshooting; more = visual noise during normal flow.

**Q: How long before I should worry if linking is stuck?**
A: All steps should complete within 2–3 minutes under normal conditions. If stuck on Step 0 after 5 minutes, pendant may not be powered on or reachable by the gateway. Check pendant battery and try power-cycling.

**Q: Can multiple guardians link the same pendant?**
A: Yes, but not via this flow. A second guardian would need the pendant's IMEI and link it independently; Firestore rules allow any guardian linked to an IMEI to see and control it. There's no "owner" concept yet — all linked guardians have equal access.


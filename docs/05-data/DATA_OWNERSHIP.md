# Data Ownership Model

Guardian's data access is built on role-based permissions: who owns each piece of data, who can read it, who can write it, and why. This page documents the current model and known limitations.

**Last updated:** July 2026. See SCHEMA.md for the authoritative data model.

---

## Overview

Guardian has three primary actors:

1. **Device Owner** — The person who set up the device or account that owns the wearable pendant
2. **Linked Guardians** — Other users the owner has invited to track and manage the same device(s)
3. **Emergency Contacts** — External recipients (SMS/WhatsApp) who get notified of critical events only

Each actor has strict read/write boundaries enforced by Firestore security rules (`firestore/rules.example`).

---

## User Ownership Model

### User Document (`users/{uid}`)

| Field | Owner | Read | Write | Notes |
|-------|-------|------|-------|-------|
| `displayName`, `email`, `phone` | Self | Self | Self | Profile identity |
| `avatarUrl` | Self | Self | Self | Firebase Storage download URL |
| `linkedImeis` | System/Owner | Self | System only | Set during device onboarding or family invite acceptance |
| `fcmTokens` | Self | Self | App only | Push registration tokens; app manages automatically |
| `subscription` | TBD | Self | Self (today); Backend when billing exists | See **Subscription Model** below |
| `emergencyContacts` | Self | Self | Self | Manually managed in app |
| `familyMembers` | Distributed | Self | Self + Other guardians | See **Family Circle Model** below |
| `role` | Gateway | Self | Gateway only | `guardian` or `admin` (reserved for future ops) |
| `createdAt`, `updatedAt` | System | Self | System | Timestamps |

**Key constraint:** Users can read and modify only their own user document (`rules.example` line 37–44). No guardian can see another's emergency contacts, subscription tier, or app tokens.

---

## Device Ownership & Linked Access

### Device Document (`devices/{imei}`)

When a device joins the network, it becomes associated with an **owner IMEI** in `users/{ownerUid}.linkedImeis`. That owner may then share access with other guardians via family invites.

| Data | Initial Owner | Read | Write | Notes |
|------|---------------|------|-------|-------|
| Telemetry (location, battery, online status) | Gateway | All linked guardians | Gateway only | Write gate: movement ≥50 m, battery change, alerts, heartbeat cap |
| `name`, `nickname`, `relationship` | Guardian (metadata) | All linked guardians | Creator guardian only | Identifier names for the wearer (e.g., "Mum", "Dad") |
| `avatarUrl` (wearer photo) | Guardian | All linked guardians | Creator guardian only | Firebase Storage (`deviceAvatars/{imei}/avatar`); storage rules enforce size/access |
| `simNumber` | Guardian | All linked guardians | Creator guardian only | Pendant's SIM phone for calls and SMS commands |
| `fallDetection`, `locationReportingIntervalSeconds` | Guardian | All linked guardians | Guardian who set it | App-cached request state (V46/V48/V52); device has no read-back, so this caches intent not confirmed state |
| Geofences | Guardian who created | All linked guardians | Creator guardian only | Safe zones; stored in `devices/{imei}/geofences` subcollection (see below) |
| Alerts | Gateway | All linked guardians | Gateway creates; all linked resolve | Device-originated alerts (`sos`, `fall`, `geofence_exit`, etc.) |
| Location history (`locations/`, `journeys/`, `segments/`) | Gateway | All linked guardians | Gateway only | Read-only for guardians; auto-generated from telemetry write gate |

**Critical rule:** A guardian may read or modify a device document **only if** the device's IMEI is in their `linkedImeis` array. This is checked by the `linkedTo(imei)` rule function (lines 12–14 in `rules.example`).

---

## Family Circle Model

Family sharing allows one device to be tracked by multiple guardians. This is a **hub-and-spoke** pattern:

```
┌─────────────────────────────────────────────────────────────┐
│                     Device (IMEI)                           │
│                  Shared by all guardians                    │
│  Telemetry, alerts, geofences visible to all in the circle │
└─────────────────────────────────────────────────────────────┘
         ▲         ▲         ▲         ▲
         │         │         │         │
         │ linked  │ linked  │ linked  │ linked
         │ to this │ to this │ to this │ to this
         │  IMEI   │  IMEI   │  IMEI   │  IMEI
         │         │         │         │
    ┌────┴──┐  ┌───┴──┐  ┌───┴──┐  ┌──┴────┐
    │ Mum   │  │ Dad  │  │ Auntie│  │Grandad│
    │ (uid1)│  │(uid2)│  │(uid3) │  │(uid4) │
    └───────┘  └──────┘  └───────┘  └───────┘
    users/uid1        users/uid2/familyMembers = [uid2, uid3, uid4, ...]
    linkedImeis: [IMEI]
```

### How to Join

1. **Device owner** generates a 6-character invite code (one `invites/{id}` doc per shared device).
2. **Other guardian** enters the code → app accepts the invite.
3. **Acceptor's changes:**
   - `users/{acceptorUid}.linkedImeis` updated by the app (or system) to add the IMEI.
   - `users/{ownerUid}.familyMembers` appended with `{ uid: acceptorUid, displayName, email? }`.

### Known Issue: One-Directional Sync

**The inviter's `familyMembers` list is never updated when the acceptor joins** (see `CLAUDE.md`, known gaps). Today:

- Acceptor can see the inviter's device (IMEI is added to their `linkedImeis`).
- Acceptor can see themselves in the invite history.
- Inviter's `familyMembers` list may be stale.

**Workaround:** Refresh the inviter's user document from Firestore to see the current family circle.

### Family Members Array (`users/{uid}.familyMembers`)

This array is **advisory** — it shows who has access to the same devices, but is not the source of truth. The real check is `linkedImeis`. Updating `familyMembers` requires:

- You are the guardian being listed, OR
- You are joining via invite and appending yourself (the `selfJoiningFamilyCircle` rule, lines 24–34 in `rules.example`).

---

## Geofence & Zone Ownership

### Geofences (`geofences/{geofenceId}`)

Safe zones are created by a guardian and visible to all guardians linked to that device.

| Field | Owner | Read | Write |
|-------|-------|------|-------|
| `imei`, `name`, `center`, `radiusMeters`, `wifiSsid`, `active` | Creator | All linked to IMEI | Creator only |
| `createdBy`, `createdAt` | System | All linked to IMEI | System |

- **Creator privilege:** Only the guardian who created a geofence can edit or delete it.
- **Shared read:** All other linked guardians can see it and receive enter/exit alerts.

**WiFi safe zones:** The `wifiSsid` field exists but is structurally non-functional — the GT06 decoder never populates a WiFi network name from device packets. (See `CLAUDE.md`, known gaps.)

---

## Medication Reminders

Reminders are device-scoped settings managed by individual guardians, but synced to the device.

| Field | Owner | Read | Write | Notes |
|-------|-------|------|-------|-------|
| `imei`, `time`, `frequency`, `text`, `enabled` | Creator | All linked to IMEI | Creator only | V46/V48/V52 only; device has no list-reminders command |
| `createdBy`, `createdAt` | System | All linked to IMEI | System | |

---

## Alerts & Incident Response

### Alerts (`alerts/{alertId}`)

Events from the device (SOS, fall, geofence exit, low battery, offline) are written by the gateway and visible to all linked guardians.

| Field | Owner | Read | Write | Notes |
|-------|-------|------|-------|-------|
| `imei`, `type`, `severity`, `message`, `payload` | Gateway | All linked to IMEI | Gateway only | Immutable incident record |
| `resolved`, `resolvedAt` | Any linked guardian | All linked to IMEI | Any linked guardian | Mark critical incidents as resolved/acknowledged |
| `notifyStatus` | Gateway | All linked to IMEI | Gateway only | Audit trail of SMS/WhatsApp attempts |

### Manual SOS Alert

Any linked guardian can create a critical `sos` alert on behalf of the wearer (app UI: "Send help alert"):

```firestore-rule
allow create: if linkedTo(request.resource.data.imei)
  && request.resource.data.type == 'sos'
  && request.resource.data.severity == 'critical'
  && ...
```

---

## Emergency Contacts (External Notifications)

Emergency contacts are stored in the guardian's own user document and receive **narrower** notifications than the guardian themselves.

### users/{uid}.emergencyContacts

| Contact Type | Receives | Does NOT Receive | Notes |
|--------------|----------|------------------|-------|
| SMS/WhatsApp | SOS, fall, geofence_exit | Enter zone, low battery, offline | Intentional; reduces notification fatigue for external recipients |
| Data access | None | Cannot read Firestore | External recipients never have Firestore access; notifications are routed through gateway only |

**Key principle:** Emergency contacts are *output-only* — they have no access to data, no login, no app. Only the gateway (via AWS SNS/Twilio/WhatsApp APIs) can send them messages.

### Notification Audit Trail

The gateway writes `notificationLogs/{id}` for each attempt:

| Field | Owner | Read | Notes |
|-------|-------|------|-------|
| `imei`, `alertType`, `message`, `contactCount`, `results` | Gateway | All linked to IMEI | Read-only audit trail |

Guardians can see which emergency contacts were contacted for a given alert and whether the message succeeded.

---

## Device Commands (Downlink)

When a guardian wants to control the device (set SOS number, check status, enable fall detection), they create a `deviceCommands` entry.

| Field | Owner | Read | Write | Notes |
|-------|-------|------|-------|-------|
| `imei`, `type`, `params` | Creator | All linked to IMEI | Creator only | Pending command request |
| `status` | Gateway | All linked to IMEI | Gateway only | `pending` → `sending` → `sent` or `failed` |
| `result` | Gateway | All linked to IMEI | Gateway only | SMS/TCP response from device |
| `createdBy`, `createdAt` | System | All linked to IMEI | System | |

**Execution:** The gateway polls `deviceCommands` with status `pending`, sends via SMS (V28C) or TCP (V46/V48/V52), updates status/result.

**Device confirmation problem:** Most pendant commands have no read-back. For example, the V28C cannot confirm fall detection is on — so the app caches the *requested* state in `devices/{imei}.fallDetection` as a best-effort guess. If the device silently resets or ignores the command, the cache becomes stale.

---

## Subscription Tier Model

**Status: Display-only; no enforcement.**

```
users/{uid}.subscription = {
  tier: 'free' | 'premium',
  status: 'active' | 'expired' | ...,
  renewsAt: <timestamp>
}
```

### Current behavior:
- Client-writable: Any guardian can set their own tier to anything.
- No Firestore rule enforcement.
- No payment processor backend.
- Tier is read by the Flutter app (e.g., to show a "Upgrade" button), but no queries are blocked based on tier.

### Future (when billing is integrated):
The `subscription` field should move to backend ownership (Cloud Function triggered by a payment webhook). Firestore rules would then gate premium features:

```firestore-rule
function isPremium(uid) {
  return get(/databases/$(database)/documents/users/$(uid)).data
    .get('subscription', {}).get('tier', '') == 'premium';
}

// Example: location history capped by tier
match /devices/{imei}/locations/{locationId} {
  allow read: if linkedTo(imei) && isPremium(request.auth.uid);
}
```

**Known limitation:** This is not implemented. Today, all linked guardians see all data regardless of tier.

---

## Data Access Matrix

### Who can read what?

| Resource | Owner | Linked Guardian A | Linked Guardian B | Emergency Contact | Gateway (Admin) |
|----------|-------|-------------------|-------------------|-------------------|-----------------|
| Device telemetry | ✓ | ✓ | ✓ | ✗ | ✓ (writes) |
| Alerts | ✓ | ✓ | ✓ | ✗ | ✓ (writes) |
| Geofences (created by owner) | ✓ | ✓ | ✓ | ✗ | ✓ |
| Location history | ✓ | ✓ | ✓ | ✗ | ✓ (writes) |
| Emergency contacts list | ✓ | ✗ | ✗ | ✗ | ✗ |
| Family members list | ✓ (partial) | Partial | Partial | ✗ | ✗ |
| Own user doc | ✓ | ✗ | ✗ | ✗ | ✗ |

### Who can write what?

| Resource | Owner Guardian | Other Linked Guardian | Emergency Contact | Gateway |
|----------|---|---|---|---|
| Device name/relationship | ✓ | ✗ | ✗ | ✗ |
| Geofence (created by owner) | ✓ (creator only) | ✗ | ✗ | ✗ |
| Medication reminder (created by A) | ✓ (creator A) | ✗ | ✗ | ✗ |
| Alert resolution | ✓ | ✓ | ✗ | ✓ |
| Device command | ✓ | ✓ | ✗ | ✓ (execute) |
| Device telemetry | ✗ | ✗ | ✗ | ✓ |
| Alert creation | ✗ (except manual SOS) | ✓ (manual SOS) | ✗ | ✓ |
| Invitation creation | ✓ | Inviter only | ✗ | ✗ |

---

## Access Control Flow Diagram

### Firestore Read Path
```
┌─────────────────────────────────────────────────────┐
│  Guardian opens app, logs in (Firebase Auth)       │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  App reads user/{uid}.linkedImeis                   │
│  Cached list: [IMEI-1, IMEI-2, IMEI-3]             │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  For each IMEI, run Firestore query:                │
│  db.collection('devices')                           │
│    .where('imei', 'in', linkedImeis)                │
│    .snapshots()                                     │
│                                                     │
│  Firestore rules:                                   │
│  allow read: if linkedTo(imei)                      │
│    ↳ Checks: request.auth.uid in linkedImeis ✓     │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Device documents returned with full telemetry      │
│  (location, battery, online status, alerts)         │
└─────────────────────────────────────────────────────┘
```

### Firestore Write Path (Create Geofence Example)
```
┌─────────────────────────────────────────────────────┐
│  Guardian in app: "Create safe zone 'Home'"         │
│  IMEI: ABC123                                       │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  App creates geofence doc:                          │
│  {                                                  │
│    imei: 'ABC123',                                  │
│    name: 'Home',                                    │
│    center: { lat, lng },                            │
│    radiusMeters: 500,                               │
│    createdBy: currentUser.uid,                      │
│    createdAt: serverTimestamp()                     │
│  }                                                  │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Firestore rules validate:                          │
│  allow create: if                                   │
│    ✓ signedIn() [has auth token]                    │
│    ✓ linkedTo(request.resource.data.imei)           │
│      [ABC123 in users/{uid}.linkedImeis]            │
│    ✓ request.resource.data.createdBy == uid         │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Geofence written to geofences/{id}                 │
│  Gateway immediately begins evaluating GPS fixes    │
│  against this zone (no config reload needed)        │
└─────────────────────────────────────────────────────┘
```

### Family Invite Flow
```
┌─────────────────────────────────────────────────────┐
│  Inviter (Mum, uid1) creates invite:                │
│  invites/{id} = {                                   │
│    code: 'ABC123',                                  │
│    createdBy: uid1,                                 │
│    linkedImeis: [IMEI-1, IMEI-2],                   │
│    status: 'pending',                               │
│    expiresAt: <7 days>                              │
│  }                                                  │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Acceptor (Auntie, uid3) enters code in app         │
│  App accepts invite (client call):                  │
│  invites/{id}.update({                              │
│    status: 'accepted',                              │
│    acceptedBy: uid3,                                │
│    acceptedAt: serverTimestamp()                    │
│  })                                                 │
│  AND appends to:                                    │
│  users/{uid1}.familyMembers.push({                  │
│    uid: uid3,                                       │
│    displayName: 'Auntie'                            │
│  })                                                 │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  System/App updates:                                │
│  users/{uid3}.linkedImeis += [IMEI-1, IMEI-2]       │
│                                                     │
│  Auntie can now read/control both devices          │
│  Auntie receives alerts from both                  │
│  Mum & Auntie see each other in familyMembers      │
└─────────────────────────────────────────────────────┘
```

---

## Security Enforcement

### Client-Side vs. Firestore Rules

**Client-side filtering** (app code) is for UX and performance:
```dart
// guardians_services.dart, line 24-34
Stream<List<String>> _watchLinkedImeis(...) {
  return db.collection('users').doc(uid).snapshots()
    .map((snap) => snap.data()?['linkedImeis'] as List?)
    .distinct();
}
```

This fetches the list of linked devices and caches it. **But this is not a security boundary** — it's advisory.

**Firestore Rules** (server-side) are the real enforcer:
```firestore-rule
allow read: if linkedTo(imei);
// linkedTo(imei) = signedIn() && imei in userDoc().linkedImeis
```

If an attacker intercepts the client and crafts a direct Firestore query for a device they're not linked to, the rules will deny it. The `linkedTo` check is always evaluated server-side.

### Admin SDK (Gateway)

The gateway uses the Firebase Admin SDK, which bypasses Firestore rules entirely. The gateway is trusted to:
- Write device telemetry (location, battery, alerts).
- Write location history, journeys, segments.
- Execute device commands.
- Manage notification logs.

If the gateway is compromised, all data is accessible. (This is inherent to any admin API; mitigation is operational: secure the gateway VM, restrict network access, monitor logs.)

---

## Known Limitations & Gaps

### Subscription Tier Gating

As documented above, subscription tiers are not enforced. A guardian on the "free" tier can read the same data as a "premium" guardian. This will need integration with a payment provider and updated rules.

### One-Directional Family Sync

Inviter's `familyMembers` list is not automatically populated when the acceptor joins. Workaround: refresh the user document.

### No Granular Role Permissions

Today there is only `guardian` and `admin` roles, but both are treated the same in rules. Future versions might support:
- **View-only guardian** — read alerts/location only, cannot create geofences or send commands.
- **Command-only guardian** — can send SOS or commands but cannot view location.
- **Admin** — can remove other guardians from a device.

### WiFi Safe-Zone Matching

The `wifiSsid` field in geofences is never populated by the device. The feature is structurally dead.

### No "Read-Back" Commands

The pendant cannot report back the current state of fall detection, upload interval, or reminder settings. The app caches the *requested* state, not confirmed state. If a command is lost in transit or ignored, the UI will show stale data.

---

## Implementation Checklist

For developers adding new features that touch user data:

- [ ] Identify the **owner** of the data (user, device, guardian, or system).
- [ ] Define **read** scope: Can other guardians see it? Emergency contacts? The gateway?
- [ ] Define **write** scope: Only the creator? Any linked guardian? System only?
- [ ] **Client-side filtering:** Fetch only linked IMEIs; filter queries by `linkedImeis`.
- [ ] **Firestore rules:** Enforce `linkedTo(imei)` or equivalent for sensitive reads; require `createdBy == uid` for resource ownership.
- [ ] **Test both:** Write a rule-compliant query, then write an invalid query and verify it fails (use `firebase serve --only firestore` locally).
- [ ] **Document in SCHEMA.md** and update this file.
- [ ] **Notify QA:** Update the GitHub wiki if the feature affects alerts, notifications, or shared access.

---

## References

- **[SCHEMA.md](../SCHEMA.md)** — Authoritative data model and write gate behavior.
- **[firestore/rules.example](../rules.example)** — Live Firestore security rules.
- **[gateway/src/firestore.js](../../gateway/src/firestore.js)** — Gateway write logic and `shouldNotify` / `shouldSms` logic.
- **[apps/mobile/lib/services/guardian_services.dart](../../apps/mobile/lib/services/guardian_services.dart)** — Flutter queries and filtering.
- **[GitHub Issues](https://github.com/vikrav14/guardian/issues)** — Feature backlog and known issues.

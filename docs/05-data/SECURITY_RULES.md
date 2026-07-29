# Firestore Security Rules

Guardian's Firestore security model enforces a strict **linked-device** access pattern: guardians can only read, create, or modify data related to devices in their `linkedImeis` list. This document explains the rules, the philosophy behind them, and how to maintain them safely.

## Philosophy

**Access is device-scoped.** A guardian cannot see another guardian's devices, and certainly cannot see unlinked devices or other guardians' data. The wearer (pendant-wearer) is a first-class citizen: they have emergency contacts and family members, but they don't authenticate to the app — the guardian does.

**The gateway owns device state.** Location, battery, online status, and alarms flow from the pendant over TCP/SMS. The app can only request changes (via `deviceCommands`) or update cosmetic labels (`nickname`, `relationship`, `avatarUrl`). This keeps the source of truth clear.

**Invites are asymmetric.** When a guardian accepts an invite and shares access to devices, they append themselves to the inviter's `familyMembers` list. The inviter is aware of the new guardian, but currently (known limitation) the new guardian's own `linkedImeis` and `familyMembers` reflect the accepted invitation — there's no hard sync back.

---

## Core Helper Functions

### `signedIn()`

```firestore
function signedIn() {
  return request.auth != null;
}
```

Any authenticated user. Used as a baseline for operations that don't require device access (e.g., reading own profile, creating new invites).

### `userDoc()`

```firestore
function userDoc() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
}
```

Fetches the current user's `/users/{uid}` document. Used to check `linkedImeis`, email, emergency contacts, and family members. **This is a Firestore get() call inside the rule**, so it costs a read and may be slower in high-traffic scenarios, but it is essential for authorization.

### `linkedTo(imei)`

```firestore
function linkedTo(imei) {
  return signedIn() && imei in userDoc().linkedImeis;
}
```

**This is the keystone rule.** Before a guardian can read, create, or modify data about a device, they must:
1. Be signed in
2. Have that IMEI in their `linkedImeis` array

Every subcollection (`locations`, `segments`, `journeys`, `alerts`, `geofences`, `medicationReminders`, `deviceCommands`, `notificationLogs`) that is device-scoped uses `linkedTo(imei)` for read access, and most use it for create/update/delete as well.

**Critical invariant:** Never weaken `linkedTo(imei)`. If you need to grant access to a device for a new feature, add the IMEI to `linkedImeis` first, via a Cloud Function or the app's family-invite flow.

### `validUserAvatar()`

```firestore
function validUserAvatar() {
  return !('avatarUrl' in request.resource.data)
    || request.resource.data.avatarUrl == null
    || (request.resource.data.avatarUrl is string
        && request.resource.data.avatarUrl.size() <= 2048);
}
```

Limits avatar URL length to prevent abuse (storing large data in a string field). Applies to `/users/{uid}` updates.

### `selfJoiningFamilyCircle(inviterUid)`

```firestore
function selfJoiningFamilyCircle(inviterUid) {
  let oldMembers = resource.data.get('familyMembers', []);
  let newMembers = request.resource.data.get('familyMembers', []);
  return signedIn()
    && request.auth.uid != inviterUid
    && request.resource.data.diff(resource.data).affectedKeys()
        .hasOnly(['familyMembers', 'updatedAt'])
    && newMembers.size() == oldMembers.size() + 1
    && newMembers[newMembers.size() - 1].uid == request.auth.uid
    && newMembers[newMembers.size() - 1].displayName is string;
}
```

Allows a guardian (acceptor) to join an existing invite by appending themselves to the inviter's `familyMembers` list. The rule ensures:
- The acceptor is not the inviter
- Only `familyMembers` and `updatedAt` fields change
- Exactly one new entry is added
- The new entry has the acceptor's UID and a non-empty display name

---

## Collection-by-Collection Rules

### `/users/{uid}`

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `signedIn() && request.auth.uid == uid` | Guardians can only read their own user document. No cross-guardian visibility. |
| **Create** | `signedIn() && request.auth.uid == uid` | On first sign-in, Firebase Auth integration or a Cloud Function creates `/users/{uid}` with default `linkedImeis: []`. |
| **Update** | `request.auth.uid == uid && validUserAvatar()` **OR** `selfJoiningFamilyCircle(uid)` | Self-updates (avatar, name, email, phone, subscription tier, emergency contacts) are allowed. Acceptors can append to `familyMembers`. |
| **Delete** | `false` | Data is never deleted; only soft-marked via status fields or migration. |

**Access pattern:** A user always knows their own devices, emergency contacts, and family members. They see what invites exist (if they're the creator or acceptor), but not invites created by others.

---

### `/devices/{imei}`

The live state of a pendant. Only the gateway (Admin SDK) writes location, battery, online status, and alarms. Guardians can request changes via `deviceCommands` and update cosmetic fields.

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `linkedTo(imei)` | Only guardians linked to this device can see its state. |
| **Create** | `false` | Devices are created by the gateway on first pendant login. |
| **Update** | `linkedTo(imei)` **AND** `affectedKeys().hasOnly([ 'name', 'nickname', 'relationship', 'avatarUrl', 'simNumber', 'fallDetection', 'locationReportingIntervalSeconds', 'updatedAt' ])` | Guardians can relabel the device, set the pendant's SIM number (used for SMS commands), and cache the last fall-detection and location-reporting settings they requested. No telemetry write. |
| **Delete** | `false` | Devices are never deleted; deactivation is handled by deleting from `linkedImeis`. |

**Allowed fields for guardian updates:**
- `name` — legacy label (deprecated, retained for backwards compatibility)
- `nickname` — preferred dashboard name (e.g., "Mimi")
- `relationship` — guardian's relationship to wearer (e.g., "Mum", "Dad")
- `avatarUrl` — wearer's profile photo (Firebase Storage URL)
- `simNumber` — pendant's SIM phone number (used for SMS commands)
- `fallDetection` — cached request state (not confirmed device state; device has no read-back command)
- `locationReportingIntervalSeconds` — cached request state (not confirmed device state)
- `updatedAt` — server timestamp

**Read-only fields** (gateway-owned):
- `location`, `speedKmh`, `course`, `accuracySource` — current telemetry
- `online`, `lastHeartbeatAt` — connectivity state
- `batteryPercent` — power status
- `lastAlarm` — last SOS/fall/alarm event
- `intelligence` — rule-based insights (geofence, fall risk, etc.)
- `firmware` — device firmware version

---

### `/devices/{imei}/locations/{locationId}` (subcollection)

Historical GPS fixes, written only by the gateway.

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `linkedTo(imei)` | Guardians linked to the device can view the location history. |
| **Write** | `false` | Gateway (Admin SDK) owns all writes. Enables route replay and analytics without client data loss. |

---

### `/devices/{imei}/segments/{segmentId}` (subcollection)

Dwell periods (stationary segments). Gateway writes when the device stays put for ≥ 10 minutes.

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `linkedTo(imei)` | Guardians can query dwell history. |
| **Write** | `false` | Gateway only. |

---

### `/devices/{imei}/journeys/{journeyId}` (subcollection)

Compressed movement routes (polyline-encoded), one document per closed journey. Gateway accumulates GPS in memory and writes when a journey ends (idle, geofence exit, day boundary, disconnect).

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `linkedTo(imei)` | Guardians can replay routes. |
| **Write** | `false` | Gateway only. |

---

### `/geofences/{geofenceId}`

Safe zones (home, school, etc.) that trigger alerts on enter/exit.

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `linkedTo(resource.data.imei)` | Only guardians linked to the target device. |
| **Create** | `signedIn() && linkedTo(request.resource.data.imei) && request.resource.data.createdBy == request.auth.uid` | The creator must be linked to the device. |
| **Update** | `linkedTo(resource.data.imei) && resource.data.createdBy == request.auth.uid` | Only the creator can edit their geofences. |
| **Delete** | `linkedTo(resource.data.imei) && resource.data.createdBy == request.auth.uid` | Only the creator can delete. |

**Sharing pattern:** If two guardians are linked to the same device, they both see all geofences for that device, but each can only modify their own. This avoids accidental deletions by the other guardian.

---

### `/alerts/{alertId}`

Events: SOS, fall detection, geofence enter/exit, low battery, offline.

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `linkedTo(resource.data.imei)` | Guardians linked to the device. |
| **Create** | `linkedTo(request.resource.data.imei) && request.resource.data.type == 'sos' && request.resource.data.severity == 'critical' && request.resource.data.resolved == false && request.resource.data.notifyStatus == 'pending' && request.resource.data.keys().hasOnly([...])` | **App-initiated SOS only.** The app can send a "Send help" alert if the user is linked to the device. All other alerts (fall, geofence, low battery, offline) are gateway-created. Strict schema enforcement prevents malformed alerts. |
| **Update** | `linkedTo(resource.data.imei) && affectedKeys().hasOnly(['resolved', 'resolvedAt'])` | Guardians can mark alerts as resolved. No other updates. |
| **Delete** | `false` | Alerts are immutable historical records. |

**App SOS creation schema:** An alert created by the app (not gateway) must have exactly these fields:
- `imei`, `type: 'sos'`, `severity: 'critical'`, `message`, `resolved: false`, `payload`, `createdAt`, `notifyStatus: 'pending'`

Any deviation is rejected.

---

### `/medicationReminders/{reminderId}`

App-side records of reminders scheduled on the device. Device has no "list reminders" query, so the app is the source of truth for what's been set.

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `linkedTo(resource.data.imei)` | Guardians linked to the device. |
| **Create** | `signedIn() && linkedTo(request.resource.data.imei) && request.resource.data.createdBy == request.auth.uid` | Creator must be linked. |
| **Update** | `linkedTo(resource.data.imei) && resource.data.createdBy == request.auth.uid` | Only the creator can edit. |
| **Delete** | `linkedTo(resource.data.imei) && resource.data.createdBy == request.auth.uid` | Only the creator can delete. Creates a matching `deviceCommands` entry to sync deletion to the pendant. |

---

### `/invites/{inviteId}`

Family share invites: one guardian creates and sends a code, another accepts and gains access to their devices.

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `signedIn()` | Any authenticated user can read any invite. (Low risk: no sensitive data in the invite itself; code is 6 random chars and expires after a set time.) |
| **Create** | `signedIn() && request.resource.data.createdBy == request.auth.uid && request.resource.data.status == 'pending'` | Creator must be the current user. Status must start as `pending`. |
| **Update** | Creator update (revoke): `resource.data.createdBy == request.auth.uid` **OR** Acceptor update (accept): `resource.data.status == 'pending' && request.resource.data.status == 'accepted' && request.resource.data.acceptedBy == request.auth.uid` | Creators can revoke (`status: 'revoked'`). Acceptors can accept (`status: 'accepted'`), which triggers the app to copy `linkedImeis` from the invite into the acceptor's `linkedImeis` and call update on the inviter's user doc to append themselves to `familyMembers`. |
| **Delete** | `signedIn() && resource.data.createdBy == request.auth.uid` | Only creators can delete their invites. |

**Invite flow:**
1. Inviter creates an invite with `linkedImeis: [...]` (snapshot of their devices at that moment) and sends the 6-char code out-of-band (WhatsApp, SMS, etc.).
2. Acceptor enters the code, reads the invite, and calls update with `status: 'accepted'`.
3. App copies the inviter's `linkedImeis` into the acceptor's document and appends the acceptor to the inviter's `familyMembers`.
4. Both guardians now see the shared devices.

**Known limitation:** If the inviter adds a new device *after* sending the invite, the acceptor won't see it until a new invite is sent and accepted.

---

### `/notificationLogs/{logId}`

Audit trail of SMS/WhatsApp notifications sent to emergency contacts.

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `linkedTo(resource.data.imei)` | Guardians can audit notification history for their devices. |
| **Write** | `false` | Gateway (Admin SDK) only. One log entry per notification fan-out event. |

---

### `/deviceCommands/{commandId}`

Downlink requests from the app: set SOS numbers, request status, voice monitor, set medication reminders, etc.

| Operation | Rule | Notes |
|-----------|------|-------|
| **Read** | `linkedTo(resource.data.imei)` | Guardians can see their own commands and results. |
| **Create** | `linkedTo(request.resource.data.imei) && request.resource.data.createdBy == request.auth.uid && request.resource.data.status == 'pending'` | Creator must be linked to the device. Status starts as `pending`. Gateway updates to `sending`, `sent`, or `failed` as it processes. |
| **Update** | `false` | Only the gateway (Admin SDK) updates status and result. Prevents app from faking delivery. |
| **Delete** | `false` | Commands are immutable records. |

---

## Access Patterns by Role

### Guardian (authenticated user linked to device)

**Can do:**
- Read own `/users/{uid}` doc
- Read device state: `devices/{imei}`, `locations`, `segments`, `journeys`
- Read alerts, geofences, medication reminders for linked devices
- Create geofences, medication reminders, alerts (SOS only)
- Update device cosmetics: nickname, relationship, avatar
- Create and manage family invites
- Accept invites from other guardians
- Resolve alerts
- Send device commands (set SOS numbers, request status, etc.)

**Cannot do:**
- Read another guardian's user doc, emergency contacts, or family members
- Modify another guardian's geofences, reminders, or commands
- See unlinked devices
- Delete devices or alerts
- Modify device telemetry (location, battery, online status)
- Force-update `linkedImeis` directly (only via invite flow)

### Emergency Contact (phone number or WhatsApp)

**Can do:**
- Receive SMS/WhatsApp alerts for SOS, fall detection, geofence exit/enter

**Cannot do:**
- Authenticate to the app
- View the app
- Create or modify anything
- See the guardian or other emergency contacts

Emergency contacts are stored in `/users/{uid}.emergencyContacts` and triggered by the gateway when an alert matches their notification criteria (SOS/fall/geofence exit only; not low battery or offline).

### Gateway (Node.js, Admin SDK)

**Can do:**
- Bypass all rules
- Create/update devices, locations, segments, journeys
- Create all alert types (device-originated: fall, geofence, low battery, offline)
- Create notification logs
- Update device commands (status, result)

**Cannot:**
- This is a trust boundary. The gateway runs in your own infrastructure. Compromising it compromises Guardian. Use strong API keys and restrict network access.

### Public (unauthenticated)

**Cannot do:**
- Anything. All operations require `signedIn()`.

---

## Data Ownership & Write Gates

| Component | Owner | Write Mechanism |
|-----------|-------|-----------------|
| Device telemetry (location, battery, online, alarms) | Gateway | TCP/SMS → Firestore (write gate every 50 m, 5 min heartbeat cap) |
| Device cosmetics (name, nickname, avatar) | Guardian | App → direct write (under `affectedKeys` rule) |
| Geofences, medication reminders | Guardian | App → direct write |
| Alerts | Gateway (mostly) + App (SOS only) | Gateway on device event; app on "Send help" |
| Invites | Guardian (creator/acceptor) | App → create/accept/revoke |
| Notification logs | Gateway | SMS/WhatsApp batch → one log document |
| Device commands | Guardian (creator) + Gateway (executor) | App creates; gateway updates status + result |

---

## Security Considerations

### Threat: Cross-guardian access

**Attack:** Alice tries to read Bob's devices by guessing an IMEI.

**Defense:** Every read checks `linkedTo(imei)`. Bob's IMEI must be in Alice's `linkedImeis`. Invitation is the only way to gain access. Compromise requires either:
- Alice intercepts Bob's invite code (send via secure channel, or use expiring time-based codes)
- Alice compromises Bob's Firebase Auth (use strong passwords, 2FA)
- Alice compromises the app or gateway (security is your responsibility)

### Threat: Wearer impersonation

**Attack:** Wearer (child) uses the app to see their own location or modify device settings.

**Defense:** There is no wearer role in the current design. Only guardians authenticate. If you want to add wearer-facing features (e.g., a wearer can read their own location for educational/sport tracking), create a new role with scoped `linkedImeis` (e.g., a wearer cannot modify geofences or see other devices), and update the rules accordingly. This is explicitly out of scope for v1.

### Threat: Malformed alert injection

**Attack:** App sends a fake "fall detected" alert to scare the guardian.

**Defense:** App-created alerts must have `type: 'sos'`, `severity: 'critical'`, `resolved: false`, and `notifyStatus: 'pending'`. Anything else is rejected. The schema check is strict: `keys().hasOnly([...])` rejects extra fields. This is intentional: the app can only shout for help, not fabricate device events.

### Threat: Leaked or malicious gateway

**Attack:** Compromised gateway floods Firestore with fake locations or creates fake devices.

**Defense:** This is a trust boundary. Run the gateway in secure infrastructure (firewall, strong API keys, audit logs). Use Firestore audit logs (Google Cloud Console) to detect anomalies. There is no in-app way to validate that a location came from the real device; Firestore rules cannot reject based on device legitimacy.

### Threat: Invite code phishing

**Attack:** Attacker impersonates Alice and sends Bob a fake invite.

**Defense:** Invites are created only by authenticated users. The code is a 6-char random string. Bob can only accept the invite if he has the code and chooses to do so. If Bob accepts a phishing invite by accident, he's linked to the attacker's devices; no automatic permissions are granted to the attacker. Bob can manually unlink by removing the IMEI from his `linkedImeis` (if that's a feature) or by asking Alice to revoke the invite.

---

## Audit & Maintenance

### Firestore Audit Logs

Enable **Cloud Audit Logs** for Firestore:
1. Go to Google Cloud Console → Logs → Query
2. Filter by `resource.type: "cloud_firestore"` and `protoPayload.methodName: "google.firestore.v1.Firestore.Write"`
3. Alert on unusual patterns: write spikes, failed auth, new users with many `linkedImeis`

### Rule Testing

Before deploying rule changes:
1. Write test cases in `firestore/security.rules.test.ts` (or similar) using the Firebase Emulator
2. Test all access patterns: self-read, cross-guardian read (should fail), linked device read (should pass), unlinked device read (should fail)
3. Test edge cases: avatar size limits, affectedKeys validation, invite acceptance race conditions

### Rule Deployment

```bash
firebase deploy --only firestore:rules
```

This deploys `firestore/rules.example` to your Firestore. **Changes are live immediately.** Have a rollback plan (prior rules in git history).

---

## Extending the Rules

If you add a new collection or feature:

1. **Identify the scope.** Is it device-scoped (geofences, commands) or user-scoped (emergency contacts, subscription)?
2. **Use `linkedTo(imei)`** if device-scoped. If user-scoped, create a helper like `isOwner(uid)`.
3. **Follow the pattern.** Read is permissive (`linkedTo`); create/update/delete are restrictive (creator check, affectedKeys validation, specific schema).
4. **Test all roles.** Self (should pass), other guardian (should fail for private data), unauthenticated (should fail).
5. **Document the access pattern** in this file and the schema.

**Example: Add a `deviceSettings` collection:**

```firestore
match /deviceSettings/{imei} {
  allow read: if linkedTo(imei);
  allow create: if signedIn() && linkedTo(request.resource.data.imei);
  allow update: if linkedTo(resource.data.imei)
    && request.resource.data.diff(resource.data).affectedKeys()
        .hasOnly(['alertVolume', 'vibration', 'updatedAt']);
  allow delete: if false;
}
```

This gives all linked guardians read access (they see shared settings), and each guardian can update cosmetic settings. Sync to the device via `deviceCommands`.

---

## References

- **[SCHEMA.md](../SCHEMA.md)** — Firestore data model (collections, fields, types, ownership)
- **[rules.example](../rules.example)** — Source of truth for deployed rules
- **[Firebase Security Rules Documentation](https://firebase.google.com/docs/firestore/security/start)** — Official Firestore rules guide
- **[GitHub Issues](https://github.com/vikrav14/guardian/issues)** — Known gaps (e.g., issue #62: asymmetric invite acceptance)

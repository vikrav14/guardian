# Security Model

**Last updated:** 2026-07-29

Guardian uses Firestore's security rules to enforce data access control. Users can only see locations of devices they've linked.

## Authentication

Users authenticate via **Firebase Auth** (email + password).

```
┌─────────────────────────────────────────┐
│ Mobile App / Web                        │
├─────────────────────────────────────────┤
│ User enters: email@example.com          │
│            password                    │
│              ↓                          │
│ Firebase Auth.signInWithEmailPassword() │
│              ↓                          │
│ Server verifies credentials             │
│              ↓                          │
│ Returns auth token (JWT)                │
│              ↓                          │
│ App stores token in local storage       │
│              ↓                          │
│ Subsequent Firestore queries include   │
│ token in Authorization header           │
└─────────────────────────────────────────┘
```

## Data Access Control

### The `linkedTo(imei)` Pattern

Firestore security rules use a helper function `linkedTo(imei)` to check if a user can access a device:

```javascript
// In firestore/rules.example
function linkedTo(imei) {
  return imei in get(/databases/$(database)/documents/users/$(request.auth.uid)).data.linkedImeis;
}
```

**What it does:**
1. Gets the current user's ID from the auth token
2. Reads `users/{uid}.linkedImeis` (array of device IMEIs)
3. Checks if the requested device IMEI is in that array
4. Returns true/false

### Firestore Rule Examples

**Reading a device's location:**
```javascript
match /locations/{docId} {
  allow read: if linkedTo(resource.data.imei);
}
```

**Reading a device's alerts:**
```javascript
match /alerts/{docId} {
  allow read: if linkedTo(resource.data.imei);
}
```

**Writing device commands:**
```javascript
match /deviceCommands/{docId} {
  allow write: if linkedTo(resource.data.imei);
}
```

**Reading device metadata:**
```javascript
match /devices/{imei} {
  allow read: if linkedTo(imei);
  allow update: if linkedTo(imei);
}
```

## User Data Isolation

Each user can only access:

✓ **Can read:**
- `users/{uid}` — own profile (email, linked devices, preferences)
- `devices/{imei}` where `imei in users/{uid}.linkedImeis` — linked device metadata
- `locations/{docId}` where `docId.imei in users/{uid}.linkedImeis` — linked device locations
- `alerts/{docId}` where `docId.imei in users/{uid}.linkedImeis` — linked device alerts

✗ **Cannot read:**
- `users/{other_uid}` — other users' profiles
- `devices/{imei}` where `imei NOT in users/{uid}.linkedImeis` — unlinked devices
- `locations/{docId}` where `docId.imei NOT in users/{uid}.linkedImeis` — unlinked device locations

### Example

```
User A: guardian@a.com
  linkedImeis: [869362111111111, 869362222222222]

User B: guardian@b.com
  linkedImeis: [869362222222222, 869362333333333]

Location data for device 869362111111111:
  ✓ User A can read
  ✗ User B cannot read

Location data for device 869362222222222:
  ✓ User A can read
  ✓ User B can read (both linked this device)

Location data for device 869362333333333:
  ✗ User A cannot read
  ✓ User B can read
```

## Device Linking

When a user links a device:

```
1. User enters IMEI: 869362111111111
2. Mobile app calls:
   users/{uid}.linkedImeis.push(869362111111111)

3. Firestore rule checks:
   allow update: if linkedTo(resource.data.imei)
   
   For linking a NEW device, this rule doesn't apply.
   Instead, use a custom rule:
   
   allow update: if request.resource.data.linkedImeis.size()
                    <= request.resource.data.linkedImeis.size() + 1

4. Device added to user's linked list
5. Mobile app can now query:
   - locations/{docId} for this IMEI
   - devices/{imei}
   - alerts/{docId}
```

## Family Sharing

Multiple users can link the same device:

```
Device IMEI: 869362111111111

User A (Grandparent)
  linkedImeis: [869362111111111]

User B (Parent)
  linkedImeis: [869362111111111]

User C (Teenager)
  linkedImeis: [869362111111111]

All three can:
  • See device location on map
  • Receive alerts
  • Change care settings

Device has ONE owner (userId), but multiple caregivers
```

## Emergency Contacts

Emergency contacts are stored **with the device**, not with the user:

```
Firestore: devices/{imei}
{
  "emergencyContacts": [
    {
      "name": "Mom",
      "phone": "+230123456789",
      "type": "primary"
    },
    {
      "name": "Doctor",
      "phone": "+230987654321",
      "type": "secondary"
    }
  ]
}
```

**Access:** Only users who've linked the device can see or edit emergency contacts.

**Notifications:** Emergency contacts receive SMS/WhatsApp alerts but cannot see the map or any data (they're external to Firestore).

## Subscription Tiers

Subscription tier is stored but **not enforced**:

```
Firestore: users/{uid}
{
  "subscriptionTier": "free",  // or "premium", "care"
  "subscriptionExpires": <timestamp>
}
```

**Current behavior:** All features available to all users (tier is display-only).

**Future:** Rules will gate features:
```javascript
// Once implemented:
allow read: if linkedTo(imei) && 
            get(/databases/$(database)/documents/users/$(request.auth.uid))
            .data.subscriptionTier in ["premium", "care"];
```

## API Key & Secrets

### Gateway `.env` File
Sensitive data is kept in `gateway/.env` (not in git):

```
FIREBASE_PROJECT_ID=guardian-xxxxx
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@appspot.gserviceaccount.com
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_ACCOUNT_SID=xxxxx
CLAUDE_API_KEY=xxxxx
```

**Not committed to git** (in `.gitignore`).

### Mobile App Firebase Config
App-level Firebase config is kept in `google-services.json` (Android) or `GoogleService-Info.plist` (iOS):

```json
{
  "project_id": "guardian-xxxxx",
  "api_key": "AIzaSyDxxxxxx",
  "app_id": "1:123456789:android:axxxxxx"
}
```

**Public** — can be in source code (Firebase config is not a secret; it's app-level).

## Data Privacy Considerations

### Location Data
- **Collected:** Every time device sends location (configurable: 30s to 1 hour)
- **Stored:** Indefinitely (in Firestore `locations/` collection)
- **Retention:** No automatic deletion; user must delete manually
- **Future:** Implement data retention policy (e.g., delete after 90 days)

### Who Can See
- Caregivers who've linked the device (Firestore rules)
- Emergency contacts (receive SMS/WhatsApp only, no data access)
- Gateway (processes raw data)
- Guardian AI (if enabled; has access to Firestore queries)

### Sensitive Operations
- **Device commands:** Logged in gateway (console); no persistent audit log
- **User authentication:** Handled by Firebase Auth (Google-managed)
- **Payment/billing:** Not implemented yet

## Known Security Gaps

1. **No audit log** — Device commands and data access aren't logged persistently
2. **No data retention policy** — Location history stored indefinitely
3. **No IP whitelisting** — Gateway listens on 0.0.0.0:9000
4. **No rate limiting** — No protection against location query spam
5. **Emergency contacts receive no auth** — SMS/WhatsApp is unguarded (anyone can intercept)
6. **Offline device commands lost** — Commands sent to offline devices are not retried
7. **No device attestation** — Any TCP connection claiming a valid IMEI is accepted

## Recommendations Before Launch

- [ ] Implement audit logging (Firestore + Cloud Logging)
- [ ] Add data retention policy (auto-delete locations > 90 days old)
- [ ] Add rate limiting to Firestore queries
- [ ] Consider device attestation or GPS verification
- [ ] Review emergency contact notification security (SMS interception risk)
- [ ] Add IP whitelisting for production gateway
- [ ] Implement command retry logic for offline devices

---

## Related Documentation

- [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) — High-level architecture
- [`../05-data/FIRESTORE_OVERVIEW.md`](../05-data/FIRESTORE_OVERVIEW.md) — Firestore schema
- [`../05-data/SECURITY_RULES.md`](../05-data/SECURITY_RULES.md) — Firestore rules explained
- [firestore/rules.example](../../firestore/rules.example) — Actual rules file (source of truth)

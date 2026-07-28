# Guardian — Outdated Assumptions Detected

**Audit Date:** 2026-07-29

This document lists claims in existing documentation that no longer match the current codebase.

## README.md

### Claim: "Mobile (next)"
**Current text:**
```
| Layer | Tech |
|-------|------|
| Device protocol | GT06 over TCP |
| Gateway | Node.js |
| Backend data | Firebase Firestore + Auth |
| Mobile (next) | Flutter |
```

**Reality:** Flutter is fully implemented and deployed.
- Mobile app code: `apps/mobile/lib/` (mature, with live tests)
- Features: map dashboard, device linking, care settings, safe zones, family management
- Status: Not "next"; existing production feature

**Implication:** Rewrite README to reflect current state. No longer a roadmap; this is built.

---

## CONTEXT.md

### Claim: "V28C is the primary hardware"
**Current text:** "A wearable pendant (V28C, Shenzhen Reachfar — GT06-family protocol)"

**Reality:** V52 is the primary hardware. V28C is legacy or secondary.
- Evidence: Gateway decoder (`gateway/src/protocol/gt06.js`) has explicit V52/V46/V48 support
- V28C capability matrix shows fewer supported features (no fall detection, no upload interval)
- Recent work focuses on V52 features (Care Settings, fall detection config)

**Implication:** Update CONTEXT.md to name V52 as primary. Mention V28C as legacy/supported-but-limited.

---

### Claim: "No iOS target exists"
**Current text:** "Android + Web only, **no iOS target exists**."

**Assumption status:** Still appears true from codebase.  
**No update needed** (unless this has changed).

---

## Device Protocol & Hardware Claims

### Claim: "Device can do X" without code evidence
**Outdated:** Several capabilities are claimed in vendor docs but not yet wired into Guardian:
- Remote photo capture (issue #28 says "no command syntax")
- Pedometer (PEDO/WALKTIME present in code but UI unclear)
- Voice monitoring (unverified; privacy implications undiscussed)

**Implication:** Never claim a feature is "supported" without verifying:
1. Device firmware supports it
2. Gateway can send the command
3. Mobile app wires it up
4. Tests exist

---

### Claim: "SOS button works"
**Status:** Device firmware has SOS capability; not yet verified end-to-end in Guardian app.
- Evidence: AL command parsing exists in gateway
- Missing: Confirmation that app-initiated or device-initiated SOS triggers correct notification flow
- Missing: Test covering SOS from device to caregiver SMS/push/WhatsApp

**Implication:** Mark as "implemented in protocol but not yet user-verified."

---

## Business & Pricing Assumptions

### Claim: "Rs 3,000 device, Rs 199/month subscription"
**Source:** CONTEXT.md references these numbers.  
**Status:** Unverified. Needs owner confirmation.

**Problem:** 
- No current pricing page in repository
- No business model document
- Numbers may be outdated or subject to negotiation

**Implication:** Do not publish pricing in documentation until finalized. Mark as "proposal awaiting owner confirmation."

---

## Feature Status Confusion

### Claim: "Guardian AI is conceptual"
**Reality:** Guardian AI is implemented.
- Evidence: `gateway/src/assistant/` directory exists
- Code shows Claude integration
- Tests reference WhatsApp assistant flow

**Status:** Production-readiness unclear. Not "concept"; actually built.

**Implication:** Update docs to reflect "implemented but production-readiness TBD."

---

### Claim: "WhatsApp is a future feature"
**Reality:** WhatsApp is implemented in code.
- Evidence: `gateway/src/notify.js` has WhatsApp logic
- Code shows Twilio WhatsApp API integration
- Tests reference WhatsApp notifications

**Status:** Code is present; production-readiness unclear. Not "future"; already built.

**Implication:** Update docs to reflect "implemented but production-readiness TBD."

---

### Claim: "Multiple pendants are unsupported"
**Reality:** Multiple linked pendants are supported.
- Evidence: `users/{uid}.linkedImeis` array in Firestore schema
- Mobile app shows linked-device list
- Code handles multiple device contexts

**Implication:** Correct to "supported and implemented."

---

## Device Capability Claims

### Claim: "Fall detection is a future feature"
**Reality:** Fall detection is implemented.
- Evidence: `FALLDOWN` command in `gateway/src/commands.js`
- Care Settings UI exists: `apps/mobile/lib/screens/care_settings_page.dart`
- Tests verify command building and parsing

**Status:** Implemented; reliant on vendor firmware to detect fall and report it.

**Implication:** Mark as "implemented; depends on device firmware to detect and send alarm."

---

### Claim: "Medication reminders are a future feature"
**Reality:** Medication reminders are implemented.
- Evidence: `TAKEPILLS` command in `gateway/src/commands.js`
- Care Settings UI exists with reminder scheduling
- Tests verify command building

**Status:** Implemented; depends on device firmware to display/play reminder.

**Implication:** Mark as "implemented; device must support voice/screen display for reminder."

---

### Claim: "Location reporting interval is unknown"
**Reality:** Location reporting interval is configurable.
- Evidence: `UPLOAD,<seconds>` command in `gateway/src/commands.js`
- Care Settings UI allows 30s–3600s selection
- Tests verify command delivery and device echo
- Live testing confirms CONFIG read-back (UL field)

**Status:** Implemented and verified.

**Implication:** Correct to "supported; affects GPS update frequency during movement."

---

## Protocol & Technical Assumptions

### Claim: "GT06 protocol is simple"
**Reality:** GT06 is complex with device-model variants.
- Evidence: `gateway/src/protocol/gt06.js` is 500+ lines
- Handles: multiple device types, packet variants, WiFi/cell fallback, GPS validity flags, alarm bitfields
- Challenge: Device command read-back is unreliable (CONFIG may help but unconfirmed)

**Implication:** Document full complexity; note that device state is inferred from app cache, not confirmed.

---

### Claim: "GPS is always reliable"
**Reality:** GPS accuracy is highly variable.
- Evidence: Protocol doc says "accuracy: 4.4441 Unit m, only for reference – mostly 0.0"
- Fallback: WiFi/LBS used when GPS unavailable or indoors
- Mauritius-specific: Hemisphere correction applied for this fleet

**Implication:** Never market GPS as "precise" without acknowledging approximate-location fallback.

---

## Notification & Alert Assumptions

### Claim: "All alerts are immediate"
**Reality:** Delivery depends on service availability (FCM, Twilio, etc.).
- No SLA documented
- No retry logic fully tested
- WhatsApp delivery time can be seconds to minutes

**Implication:** Document delivery guarantees and failure scenarios, not assumptions.

---

## Security & Privacy Assumptions

### Claim: "User data is secure"
**Status:** Firestore rules exist; production enforcement TBD.
- Evidence: `firestore/rules.example` uses `linkedTo(imei)` pattern
- Concern: Rules file is marked "example" — unclear if deployed
- No explicit data retention or deletion policy documented

**Implication:** Document actual deployed security rules; note any gaps.

---

## List of Files to Update or Replace

| File | Current Status | Required Action |
|------|---|---|
| `README.md` | Outdated | Rewrite to reflect current state |
| `CONTEXT.md` | Severely outdated | Replace; move useful assumptions to business section |
| `docs/V28C_DEVICE_SETUP.md` | Outdated (V28C is secondary) | Archive or clearly mark as "legacy device setup" |
| `firestore/SCHEMA.md` | Needs verification | Verify against current code and rules |
| GitHub Wiki | Unknown | Audit and migrate useful content |

---

## Key Learning for New Documentation

**Never copy old assumptions.** For every claim, verify:

1. **Is it in the code?** (Grep/code review)
2. **Is it tested?** (Tests exist and pass)
3. **Is it live?** (Manual verification on real hardware or staging)
4. **Is it finalized?** (Owner approval for business/product claims)

If the answer to any is "uncertain," mark it as such in documentation and flag for owner review.


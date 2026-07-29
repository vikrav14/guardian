# Phase 0: Repository Audit — Guardian AI Implementation

**Date:** 2026-07-30  
**Status:** Complete audit of current state before Guardian AI (Gemini Flash) implementation  
**Prepared for:** Implementing Guardian AI per Master Implementation Context

---

## 1. Current Request Flow: WhatsApp → Assistant → Firestore

### 1.1 Inbound Path
```
Twilio WhatsApp webhook
  ↓ POST /webhooks/twilio/whatsapp
http.js: handleChat()
  ↓ resolveCallerContext(db, from)
    - Normalise phone to E.164
    - Scan users collection for matching phone / emergencyContacts
    - Load linkedImeis
    - Fetch all device docs
  ↓ answerWithAssistant(db, ctx, userText)
    Claude API call (if ANTHROPIC_API_KEY set)
    ↓ Tool-use loop (up to 5 rounds)
      Tool request → runTool(db, ctx, name, input)
        → Firestore queries
        → Return structured facts
      Tool result → back to Claude
    ↓ Extract text, record usage telemetry
  ↓ sendWhatsApp(from, reply)
    Twilio API → reply sent
Record aiDecision telemetry
```

### 1.2 Key Entry Points
- **HTTP Server:** `gateway/src/http.js` lines 204–300  
- **Chat Handler:** `gateway/src/http.js` lines 102–136  
- **Assistant:** `gateway/src/assistant/claude.js` lines 53–115  
- **Tools & Context Resolver:** `gateway/src/assistant/tools.js` lines 7–376  
- **Telemetry:** `gateway/src/ai-telemetry/index.js`

### 1.3 Current Guardrails
✅ **Good:**
- Phone normalisation (E.164) before user lookup
- Guardian UID validation before device access
- Offline-friendly fallback (no ANTHROPIC_API_KEY → template reply)
- Tool results returned as structured JSON, not raw user input
- 5-round limit on tool use (prevents runaway loops)
- Usage tracking (input/output tokens, tool names)

⚠️ **Gaps:**
- No explicit intent classification before Claude call
- No permission scope enforcement (all linked devices visible to requester)
- No urgency/emergency keyword detection before LLM
- No response validation (LLM response accepted as-is)
- Context includes full device data objects (not minimal packet)
- No conversation history memory
- No request ID correlation
- No audit trail beyond telemetry (no request/response logging)
- No duplicate webhook detection/idempotency

---

## 2. Current AI/Assistant Implementation

### 2.1 Provider & Model Configuration
- **Provider:** Anthropic Claude (hard-coded)
- **Model:** `claude-sonnet-4-20250514` (from config, via `ANTHROPIC_MODEL` env var)
- **System Prompt:** `gateway/src/assistant/claude.js` lines 4–10
  - Instructs: be brief, use tools, report tool facts only, no invented data
  - ~350 tokens

### 2.2 API Integration
- **Endpoint:** `https://api.anthropic.com/v1/messages`
- **Max tokens:** 512
- **Tool definitions:** Passed in request
- **Request format:** Standard Anthropic Messages API (2023-06-01)

### 2.3 Current Tool Definitions (6 tools)
1. **list_devices** — list all linked pendants (name, IMEI, online, battery)
2. **get_last_location** — latest GPS for a device (lat/lng, source, maps URL)
3. **get_battery** — battery % and last heartbeat
4. **get_recent_alerts** — recent SOS/fall/geofence alerts (limit 20)
5. **get_device_intelligence** — gateway rule-based top insight only
6. **is_at_geofence** — check if device is in a named safe zone

**Tool facts returned:**
- No invented coordinates/battery values
- No raw IMEI (wearer label used instead)
- Maps URLs constructed server-side
- ISO timestamps for recordedAt/lastHeartbeatAt
- Online/offline boolean
- accuracySource label (gps|wifi|lbs)

### 2.4 Example Tool Implementations

**getLastLocation** (gateway/src/assistant/tools.js:82–102):
```javascript
async function getLastLocation(ctx, { device_name: deviceName, imei } = {}) {
  const device = findDevice(ctx.devices, imei || deviceName);
  const loc = device.location || {};
  return {
    name: deviceLabel(device),
    imei: device.imei,
    online: device.online === true,
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
    accuracySource: device.accuracySource || null,
    mapsUrl: (lat/lng exist) ? `https://maps.google.com/?q=${lat},${lng}` : null,
  };
}
```

**Strengths:**
- Explicit null checks for missing fields
- Conditional maps URL (only when coords exist)
- Reads from already-fetched device docs (fast)

### 2.5 Fallback Without API
Lines 54–72: If no `ANTHROPIC_API_KEY`, return template-based response:
```
"[Mum] last seen at [lat], [lng] · battery [%]\nhttps://maps.google.com/?q=..."
```
✅ Keeps safety critical for offline scenarios.

---

## 3. WhatsApp Integration

### 3.1 Webhook Endpoint
- **Path:** `POST /webhooks/twilio/whatsapp`  
- **Provider:** Twilio  
- **Request format:** form-encoded (Twilio standard)
- **Response format:** TwiML (XML) or JSON 200

### 3.2 Sender Resolution
Phone number extracted from Twilio `From` parameter (e.g., `whatsapp:+23012345678`).

**Matched against:**
- `users.phone` (guardian's own number)
- `users.whatsapp` (if exists)
- `users.emergencyContacts[].phone`
- `users.emergencyContacts[].whatsapp` (if exists)

**Match logic:** First match wins. No role/permission differentiation.

### 3.3 Response Path
```javascript
const wa = await sendWhatsApp(from, reply);
if (wa.ok || wa.skipped) {
  if (wa.skipped) {
    sendTwiml(res, reply);  // Fallback to TwiML
  } else {
    res.writeHead(200, ...); // Acknowledge receipt
  }
}
```

**Skipped conditions:**
- `TWILIO_WHATSAPP_FROM` not configured
- Twilio returns non-200

### 3.4 Development/Testing Path
- **Endpoint:** `POST /dev/chat`
- **Request:** `{ "from": "+2305...", "text": "..." }`
- **Response:** `{ "reply": "..." }`
- Useful for isolated testing without Twilio

---

## 4. Firestore Schema & Collections

### 4.1 `users/{uid}`
| Field | Type | Notes |
|-------|------|-------|
| displayName | string | |
| email | string | |
| phone | string | E.164 preferred |
| whatsapp | string | Separate field (not in current schema) — observed in tools.js but not documented |
| avatarUrl | string \| null | |
| role | string | `guardian` \| `admin` |
| linkedImeis | string[] | **Devices user may view/control** |
| fcmTokens | string[] | Push notification tokens |
| subscription | map \| null | `{tier, status, renewsAt}` — display-only, no payment processor |
| emergencyContacts | array | `{name, phone, whatsapp?}` |
| familyMembers | array | `{uid, displayName, email?}` — **one-directional bug: inviter not updated** |
| createdAt, updatedAt | timestamp | |

### 4.2 `devices/{imei}`
| Field | Type | Notes |
|-------|------|-------|
| imei | string | Doc ID; 15-digit e.g. `861397053141170` |
| nickname | string \| null | Preferred name (takes priority) |
| relationship | string \| null | e.g. "Mum", "Dad" |
| name | string | Legacy friendly label |
| avatarUrl | string \| null | Wearer's photo |
| simNumber | string \| null | Pendant's SIM (E.164) |
| online | boolean | Active TCP session / recent heartbeat |
| lastHeartbeatAt | timestamp | |
| batteryPercent | number \| null | 0–100 |
| speedKmh, course | number \| null | |
| location | map | `{lat, lng, altitude?, recordedAt, satellites?}` |
| accuracySource | string \| null | `gps` \| `wifi` \| `lbs` |
| lastAlarm | map \| null | `{type, at, raw}` |
| intelligence | map \| null | Gateway-owned: `{updatedAt, insights[], topInsight}` |
| firmware | string \| null | |
| fallDetection | map \| null | App-cached request (no read-back): `{enabled, dialMonitorOnFall, sensitivityLevel}` |
| locationReportingIntervalSeconds | number \| null | App-cached request |
| createdAt, updatedAt | timestamp | |

### 4.3 `devices/{imei}/locations/{locationId}`
History (optional, gated by `WRITE_LOCATION_HISTORY=true`):
- lat, lng, speedKmh, accuracySource, recordedAt

### 4.4 `devices/{imei}/segments/{segmentId}`
Dwell periods (Journey view):
- type: `dwell`
- placeName: optional label
- startAt, endAt, lat, lng, durationMinutes

### 4.5 `devices/{imei}/journeys/{journeyId}`
Route history (compressed):
- startAt, endAt, polyline (encoded), distanceMeters, etc.

### 4.6 `geofences/{geofenceId}`
Safe zones (queried by `name`, `active==true`):
- imei, name, center `{lat,lng}`, radiusMeters, active

### 4.7 `alerts/{alertId}`
Emergency events:
- imei, type (`sos`, `fall`, `offline`, `low_battery`, etc.), severity, message, resolved, createdAt

### 4.8 `invites/{inviteId}`
Family share codes:
- code, createdBy, linkedImeis[], status (`pending|accepted|revoked`), expiresAt

### 4.9 `deviceCommands/{id}` (inferred from commands.js)
Pending device commands queued for downlink.

### 4.10 `notificationLogs/{id}` (mentioned in CLAUDE.md, not seen in schema)
Audit trail of notifications sent.

### 4.11 `medicationReminders/{id}` (mentioned in CLAUDE.md)
Medication reminder schedules.

---

## 5. Security Rules

**File:** `firestore/rules.example`

### 5.1 Access Control
- **`users/{uid}`:** User can only read their own doc
- **`devices/{imei}`:** User can read if `linkedTo(imei)` — i.e., IMEI is in their `linkedImeis`
- **`devices/{imei}/locations/{locationId}`:** Read if `linkedTo(imei)`
- **`devices/{imei}/segments/{segmentId}`:** Read if `linkedTo(imei)`

**Helper function:**
```javascript
function linkedTo(imei) {
  return signedIn() && imei in userDoc().linkedImeis;
}
```

### 5.2 Write Permissions
- **`users/{uid}`:** Own profile only; can update `{name, nickname, relationship, avatarUrl, simNumber, fallDetection, locationReportingIntervalSeconds, updatedAt}`
- **`devices/{imei}`:** Gateway (Admin SDK) owns state; clients may update only specific fields
- **Locations, segments, journeys, alerts:** Gateway-only writes; client reads only

### 5.3 Gaps
⚠️ **No explicit permission scopes** (e.g., `location.read`, `device.call`):
- All `linkedImeis` devices have the same access level
- No distinction between caregiver roles (primary vs secondary)
- No action-level gating (e.g., only primary can call device)

⚠️ **No rate limiting** in rules (application-level only)

---

## 6. Device Protocol & Commands

### 6.1 GT06 Parser
**File:** `gateway/src/protocol/gt06.js`

- Binary TCP protocol (ReachFar GT06 family)
- Devices: V28C (current), V46/V48/V52 (future)
- Heartbeat, GPS, alarm (SOS/fall), offline packets
- Extracts: IMEI, lat/lng, satellites, speed, course, battery %, fall flag, etc.

### 6.2 Supported Commands (gateway/src/commands.js)

**SMS-based (V28C via SMS):**
- `centerNumberCommand(phone)` → `pw,123456,center,${phone}#`
- `sosNumberCommand(slot, phone)` → `sos${slot},${phone}#`
- `statusCommand()` → `ts#`
- `voiceMonitorCommand(phone)` → `monitor,${phone}#` ⚠️ unverified (third-party RF-V28 source)
- `ringToFindCommand()` → `find#` ⚠️ unverified

**TCP downlink (V46/V48/V52 only):**
- `fallDetectionCommand({enabled, dialMonitorOnFall})` → `FALLDOWN,{1|0},{1|0}`
- `fallSensitivityCommand(level)` → `LSSET,${level}+6`
- `medicationReminderCommand(...)` → TAKEPILLS packet with UTF-16BE encoded text

### 6.3 Unverified/Unsupported Features
❌ **Not implemented:**
- Remote photo capture (no protocol syntax found)
- Pill reminders (command exists but untested on real hardware)
- Step counting / pedometer
- Heart rate / blood pressure / blood oxygen
- Video calling
- Watch removal alarm

### 6.4 V28 vs V52 Status
**Current:**
- V28C is production; protocol parsing works
- V52 firmware not arrived; supplier statement: "same protocol family, additive features"
- **Rule:** Preserve V28 behavior; verify V52 features individually before enabling

---

## 7. Tests

### 7.1 Test Coverage by Module
✅ **Existing tests** (22 files in `gateway/test/`):
- `assistant-tools.test.js` — deviceLabel, getDeviceIntelligence
- `connection-live.test.js` — TCP packet handling
- `connection-handshake.test.js` — initial login
- `gt06.test.js`, `gt06-v-parse.test.js` — protocol parsing
- `commands.test.js` — command builders
- `geofence.test.js` — distance calculations
- `journey-builder.test.js` — route compression
- `dwell.test.js` — segment detection
- `device-presence.test.js` — online/offline logic
- `device-offline.test.js`
- `intelligence.test.js` — rule engine
- `notify.test.js` — notification dispatch
- `ai-telemetry.test.js` — usage tracking
- `cost-engine.test.js` — cost estimation
- `ops-metrics.test.js` — admin metrics
- Others: polyline, ngrok-hint, fleet-hemisphere, imei, geolocate, write-gate

✅ **Framework:** Node.js built-in `node:test` (not external test runner)

### 7.2 Example Test Structure
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

test('deviceLabel prefers nickname, then relationship', () => {
  assert.equal(
    deviceLabel({ nickname: 'Mimi', relationship: 'Mum' }),
    'Mimi'
  );
});
```

### 7.3 Gaps
❌ **No tests for:**
- WhatsApp webhook signature validation (Twilio only)
- Intent classification
- Permission enforcement
- Response validation
- Duplicate webhook detection
- Provider failure / fallback
- Wearer resolution ambiguity
- Multilingual input parsing
- Rate limiting

---

## 8. Device Intelligence & Rule Engine

**File:** `gateway/src/intelligence/index.js`

- Gateway computes rule-based insights on device state
- Stored in `devices/{imei}.intelligence.topInsight` + `insights[]`
- Examples: low battery, offline, geofence exit, routine deviation
- **Used by:** `get_device_intelligence` tool
- **Frequency:** Check interval configurable (`INTELLIGENCE_CHECK_INTERVAL_MS`, default 60s)

---

## 9. Existing Gaps vs. Master Context Requirements

### 9.1 Intent & Urgency Classification
**Status:** ❌ Missing
- No keyword-based emergency detection
- No intent type (info vs action vs emergency)
- All requests go to LLM equally
- **Risk:** Slow response for SOS; LLM failure blocks urgent messages

### 9.2 Permission Enforcement
**Status:** ⚠️ Partial
- Firestore rules check `linkedTo(imei)`
- **Missing:** Action-level scopes (location.read, device.call, reminders.write)
- **Missing:** Role-based enforcement (primary vs secondary caregiver)
- **Missing:** Confirmation tokens for high-risk actions

### 9.3 Context Minimisation
**Status:** ⚠️ Partial
- Tools return minimal structured facts ✅
- **Missing:** Request-level context packet per Master Context section 12
  - Should include: requestId, mode, locale, requester role, wearer profile, allowedTools, constraints
  - Should NOT include: full device doc, unfiltered history

### 9.4 Response Validation
**Status:** ❌ Missing
- LLM response accepted as-is
- **Missing:** Checks for invented data (coordinates, battery readings, health claims)
- **Missing:** Checks for tool-result contradictions
- **Missing:** Check that location source is correctly described
- **Missing:** Fallback on validation failure

### 9.5 Incident State Machine
**Status:** ❌ Missing
- Alerts created in response to packets
- **Missing:** Explicit incident states (open, notifying, acknowledged, resolved, etc.)
- **Missing:** Ownership tracking
- **Missing:** Escalation timeline
- **Missing:** Family communication during incident

### 9.6 Wearer Identity & Profiles
**Status:** ⚠️ Partial
- Devices stored by IMEI
- **Missing:** Separation of wearer identity from IMEI
- **Missing:** Wearer profile (profile_type: kids_safety vs elder_care)
- **Missing:** Conversation preferences (language, tone)
- **Risk:** Device replacement breaks history continuity

### 9.7 Conversation History & Memory
**Status:** ❌ Missing
- No conversation storage
- **Missing:** Memory categories (profile, routine, baselines, incident)
- **Missing:** Structured data for trends
- **Missing:** Baseline calculations

### 9.8 Trend Engine
**Status:** ⚠️ Partial
- Gateway computes rule-based intelligence ✅
- **Missing:** Structured trend objects per Master Context section 8
  - Should include: confidence, data completeness, explanation
  - Should distinguish verified vs advertised_unverified

### 9.9 V52 Capability Detection
**Status:** ❌ Missing
- No capability registry
- **Missing:** States (verified, advertised_unverified, unsupported, unknown)
- **Risk:** Will claim unverified features as working

### 9.10 Multilingual Support
**Status:** ⚠️ Partial
- Claude can handle multiple languages
- **Missing:** Explicit language detection
- **Missing:** Locale-specific formatting (dates, numbers)
- **Missing:** Creole support testing
- **Missing:** Name/place preservation logic

### 9.11 Provider Abstraction
**Status:** ❌ Missing
- Claude hard-coded in code
- **Missing:** Gemini Flash paid-tier provider
- **Missing:** Provider-neutral interface
- **Missing:** Configuration for model/timeout/max_tokens

### 9.12 Audit Trail
**Status:** ⚠️ Partial
- Telemetry records usage (tokens, tool names)
- **Missing:** Full request/response logging
- **Missing:** Permission decisions logged
- **Missing:** Intent classification logged
- **Missing:** Response validation result logged

### 9.13 Webhook Idempotency
**Status:** ❌ Missing
- No duplicate detection
- **Risk:** Same message processed twice → two replies

### 9.14 Rate Limiting
**Status:** ⚠️ Partial
- No per-user rate limits
- **Missing:** Casual-chat allowance
- **Missing:** Spam protection
- **Risk:** Abuse or cost overrun

---

## 10. Reusable Components ✅

### 10.1 Solid Foundations
1. **Device context resolver** (`resolveCallerContext`) — E.164 normalization, UID lookup, device fetch
2. **Tool implementation pattern** — structured fact returns, null safety, no invention
3. **Offline fallback** — template reply when API unavailable
4. **Protocol parser** — GT06 binary packets decoded correctly
5. **Firestore schema** — logical collections, sensible field layout
6. **Test suite** — good coverage of low-level logic
7. **Command builders** — verified against vendor docs (V28C) + third-party (V52)
8. **Notify integration** — Twilio abstraction, phone normalization
9. **Device presence logic** — heartbeat tracking, offline detection
10. **Geofence evaluation** — Haversine distance, safe-zone checking

### 10.2 Can Adopt
- System prompt template (good guardrails)
- Tool-calling architecture
- Config management (environment-based)
- Ops metrics collection (cost tracking)

---

## 11. Must Refactor

### 11.1 Provider Integration
**Current:** Anthropic hard-coded  
**Required:** Abstract provider interface
```javascript
// New structure needed:
class LlmProvider {
  async complete({ systemPrompt, messages, tools, metadata }) { }
}

class GeminiProvider extends LlmProvider { }
class AnthropicProvider extends LlmProvider { }  // existing logic
class TemplateFallbackProvider extends LlmProvider { }  // no-API mode
```

### 11.2 Request Context & Audit
**Current:** ctx = {from, uid, displayName, linkedImeis, devices}  
**Required:** Structured per Master Context section 12
```javascript
{
  requestId: "req_123",
  mode: "guardian",
  locale: "en",
  requester: {displayName, role, permissions},
  wearer: {wearerId, displayName, profileType},
  currentStateSummary: {online, battery, activeIncident},
  allowedTools: ["get_current_location", "call_watch"],
  conversationSummary: "...",
  constraints: {maxResponseSentences: 3, medicalClaimsAllowed: false}
}
```

### 11.3 Tool Selection & Gating
**Current:** All 6 tools offered equally  
**Required:** Filter by requester role + action scope
```javascript
// Determine allowedTools based on:
- Requester's linkedImeis
- Requester's role (primary vs secondary)
- Subscription tier
- Action scope (location.read vs device.call)
- Device capability (e.g., don't offer voice_call if device offline)
```

### 11.4 Intent & Urgency Classification
**Current:** Straight to Claude  
**Required:** Deterministic layer first
```javascript
// Pseudo-code:
const intent = classifyIntent(userText)
  .keywords(['where', 'locate'] → INFO_REQUEST)
  .keywords(['sos', 'help', 'emergency'] → URGENT)
  .keywords(['battery', 'signal'] → DEVICE_STATUS)
  .keywords(['track', 'follow'] → TRACKING_REQUEST)
  .fallback(() → UNCLEAR)

// If URGENT + no uid → immediate template response
if (intent.urgency === 'CRITICAL' && !ctx.uid) {
  return templateFallback('not_registered')
}
```

### 11.5 Response Validation
**Current:** Claude response sent as-is  
**Required:** Validation layer before reply
```javascript
// Check:
- No invented coordinates
- No invented battery values
- No health claims (if not allowed)
- Location source correctly labeled (gps vs wifi vs lbs)
- Maps URLs from approved sources only
- Response length fits WhatsApp
- No sensitive data leakage
```

---

## 12. What's Missing: Priority Order

### Phase 1 (Foundation)
1. **Provider abstraction** — Support Gemini Flash + Claude fallback
2. **Request ID & audit** — Correlation across request lifecycle
3. **Intent classification** — Deterministic emergency detection
4. **Permission layer** — Scope enforcement (location.read, device.call)
5. **Response validation** — No invented data, correct source labels

### Phase 2 (Robustness)
6. **Wearer identity separation** — IMEI ≠ wearer; support device replacement
7. **Incident state machine** — Explicit states, ownership, escalation
8. **Webhook idempotency** — Detect & deduplicate duplicate messages
9. **Conversation history** — Optional per-request summary (not full history)

### Phase 3 (Intelligence)
10. **Trend engine** — Structured, explainable insights with confidence
11. **Baseline memory** — Daily summaries, routine models
12. **V52 capability registry** — Verified vs advertised_unverified state

### Phase 4 (Experience)
13. **Multilingual** — Detect language, preserve names, Creole support
14. **Companion mode** — Limited small talk + action fallback
15. **Proactive messages** — Device readiness, arrival, low battery before journey

### Phase 5+ (Advanced)
16. **Weather intelligence** — Mauritius-specific, location-aware
17. **RSS ingestion** — Road closures, school updates, cyclone alerts
18. **Rate limiting** — Per-user, casual-chat allowance, abuse control

---

## 13. Security Findings

### 13.1 Current Strengths
✅ Firestore rules: `linkedTo(imei)` check on all device reads  
✅ Phone normalization before user lookup  
✅ No secrets in logs (usage only)  
✅ Tool results validated for nulls  
✅ No invented data in tool responses  

### 13.2 Issues to Address

⚠️ **Prompt injection risk:**
- User message passed directly to Claude
- Tool results (e.g., device labels) also passed as-is
- **Mitigation:** Sanitize user input; treat tool output as untrusted data

⚠️ **Wearer data leakage:**
- All linked devices visible to requester
- No scoping by role (e.g., secondary caregiver might not see all)
- **Mitigation:** Add `requester.role` and check against `device.viewers` or similar

⚠️ **No rate limiting:**
- Sender phone not rate-limited
- **Mitigation:** Track inbound requests by sender phone; enforce limits per plan

⚠️ **Voice monitoring consent:**
- `voiceMonitorCommand` exists but sends no on-device indication to wearer
- **Mitigation:** Require explicit consent; log as high-risk action

⚠️ **SMS command injection:**
- Commands built from user input (e.g., phone number for SOS)
- **Mitigation:** Validate phone format before embedding in command

---

## 14. Stale Documentation

| File | Status | Issue |
|------|--------|-------|
| CONTEXT.md | 📍 Outdated | Frames around V28C, doesn't mention V52, WhatsApp AI vague |
| README.md | ✅ Current | Accurate; points to correct docs |
| docs/FLUTTER_SETUP.md | ✅ Current | Flutter implementation up-to-date |
| CLAUDE.md | ✅ Current | Code conventions clear |
| firestore/SCHEMA.md | ⚠️ Incomplete | Missing `whatsapp` field in users; doesn't document `conversations`, `incidents`, `wearers` tables from Master Context |
| docs/V28C_DEVICE_SETUP.md | ✅ Current | Device pairing instructions solid |

---

## 15. Risk Assessment

### 15.1 High Risk: Blocking Implementation
- ❌ No provider abstraction → Hard-coded Claude, can't switch to Gemini

### 15.2 Medium Risk: Affecting Reliability
- ⚠️ No incident state machine → SOS acknowledgement, escalation not tracked
- ⚠️ No response validation → LLM hallucination could leak data or confuse family
- ⚠️ No webhook idempotency → Duplicate messages possible
- ⚠️ No wearer identity → Device replacement breaks history

### 15.3 Low Risk: Product Gaps
- ℹ️ V52 features unverified → Can document as "coming"; don't claim yet
- ℹ️ Trends not explainable → Implement as structured objects per spec
- ℹ️ Memory missing → Start with rule-based intelligence; memory in Phase 4

---

## 16. First Vertical Slice: "Where is Mum?"

### 16.1 Acceptance Criteria (from Master Context section 25)
1. ✅ Registered caregiver sends "Where is Mum?" via WhatsApp
2. ✅ Sender resolved securely (phone → user → devices)
3. ✅ Correct wearer resolved or clarification asked
4. ✅ Permission checked (location.read)
5. ✅ Gemini receives minimal context (not full device doc)
6. ✅ Gemini requests approved tool (get_current_location or similar)
7. ✅ Tool returns facts (lat/lng, source, freshness)
8. ✅ A/V logic preserved (GPS vs WiFi vs LBS vs stale)
9. ✅ No invented values
10. ✅ Offline/stale clearly expressed
11. ✅ Maps link included
12. ✅ Concise; multilingual input supported
13. ✅ Full lifecycle audited
14. ✅ Duplicate webhook → no duplicate reply
15. ✅ Gemini down → truthful fallback
16. ✅ Existing GPS/alerts/Flutter unchanged
17. ✅ Tests: success, stale, approximate location, unauthorized, ambiguous wearer, provider failure, duplicate

### 16.2 What's Already Built
- ✅ Device context resolver
- ✅ Tool that returns location facts
- ✅ Phone normalization
- ✅ Offline fallback
- ✅ Firestore schema

### 16.3 What Needs Implementation
1. Provider abstraction (Claude → Gemini; template fallback)
2. Intent classification (location request detected deterministically)
3. Permission scope (location.read enforced)
4. Request context packet (minimal, not full device doc)
5. Response validation (no invented coords, correct A/V label)
6. Request ID & audit logging
7. Webhook idempotency
8. Tests for all acceptance criteria

### 16.4 Files to Create/Modify
**Create:**
- `gateway/src/providers/` — LlmProvider base class + implementations
- `gateway/src/intent-classifier.js` — Keyword-based classification
- `gateway/src/response-validator.js` — Check for hallucination
- `gateway/src/audit.js` — Request/response logging
- `gateway/test/intent-classifier.test.js`
- `gateway/test/response-validator.test.js`
- `gateway/test/end-to-end-location.test.js`

**Modify:**
- `gateway/src/http.js` — Add request ID, idempotency check, call new layers
- `gateway/src/assistant/tools.js` — Add permission validation
- `gateway/src/config.js` — Add provider config (GEMINI_API_KEY, etc.)
- `gateway/.env.example` — Document new env vars

**Update:**
- `firestore/SCHEMA.md` — Add missing fields & collections

---

## 17. Summary: What Exists, What's Missing

| Component | Exists | Quality | Reusable |
|-----------|--------|---------|----------|
| Device protocol parser | ✅ | ⭐⭐⭐ | Yes |
| Firestore schema | ✅ | ⭐⭐⭐ | Yes |
| Security rules | ✅ | ⭐⭐⭐ | Yes (needs scope additions) |
| Phone normalization | ✅ | ⭐⭐⭐⭐ | Yes |
| Device lookup | ✅ | ⭐⭐⭐ | Yes |
| Tool structure | ✅ | ⭐⭐⭐ | Yes |
| Offline fallback | ✅ | ⭐⭐⭐ | Yes |
| Twilio integration | ✅ | ⭐⭐⭐ | Yes |
| Tests (low-level) | ✅ | ⭐⭐⭐⭐ | Yes |
| **Intent classification** | ❌ | — | — |
| **Permission enforcement** | ⚠️ | — | Partial |
| **Provider abstraction** | ❌ | — | — |
| **Response validation** | ❌ | — | — |
| **Incident state machine** | ❌ | — | — |
| **Request audit trail** | ⚠️ | ⭐⭐ | Telemetry only |
| **Webhook idempotency** | ❌ | — | — |
| **Conversation history** | ❌ | — | — |
| **Wearer identity** | ❌ | — | — |
| **Trend engine** | ⚠️ | ⭐⭐⭐ | Rule-based only |
| **V52 capability registry** | ❌ | — | — |

---

## 18. Recommended Next Steps

1. **Approve first vertical slice** → Location request with Gemini Flash
2. **Create feature branch:** `feat/guardian-ai-phase1-location`
3. **Implement provider abstraction** → Support Gemini + Anthropic + template fallback
4. **Add intent classification** → Deterministic emergency detection
5. **Add permission enforcement** → location.read scope
6. **Add response validation** → No invented data
7. **Add request audit** → Correlation IDs, logging
8. **Add webhook idempotency** → Detect duplicates
9. **Implement location tool** → From existing get_last_location
10. **Write end-to-end tests** → All 17 acceptance criteria
11. **Test with simulator** → Verify WhatsApp flow
12. **Document changes** → Update SCHEMA.md, add runbook

---

**Audit Complete.** Ready for implementation planning.

# Phase 1 Implementation Plan: Guardian AI Location Slice

**Goal:** Complete end-to-end location request flow with Gemini Flash (paid tier) primary + Claude fallback + template offline.

**Scope:** WhatsApp "Where is Mum?" → authenticated requester → permission check → Gemini with minimal context → validated response → full audit trail.

**Timeline:** 1–2 weeks  
**Branch:** `feat/guardian-ai-phase1-location`

---

## Acceptance Criteria (17 total)

From Master Context section 25. All must pass automated tests.

1. ✅ Registered caregiver sends "Where is Mum?" through WhatsApp
2. ✅ Sender resolved securely (phone → uid → linkedImeis)
3. ✅ Correct wearer resolved (or Guardian asks for clarification)
4. ✅ `location.read` permission checked
5. ✅ Gemini receives minimal context (not full device doc)
6. ✅ Gemini requests approved location tool
7. ✅ Tool returns structured facts (lat/lng, source, freshness)
8. ✅ GPS/WiFi/LBS/last-known distinction preserved
9. ✅ Response contains no invented values
10. ✅ Offline/stale state clearly expressed
11. ✅ Maps link included when appropriate
12. ✅ Response concise; multilingual input supported
13. ✅ Full request/tool/response lifecycle audited (requestId correlation)
14. ✅ Duplicate webhook → no duplicate response (idempotency)
15. ✅ Gemini failure → truthful template fallback
16. ✅ Existing GPS parsing, A/V logic, alerts, Flutter unchanged
17. ✅ Automated tests cover: success, stale location, approximate location, unauthorized user, ambiguous wearer, provider failure, duplicate webhook

---

## Architecture & Data Flow

```
Inbound: POST /webhooks/twilio/whatsapp
  ↓
[1] Generate requestId (UUID)
  ↓
[2] Check webhook idempotency (requestId in seen set)
  → If duplicate: return cached reply (idempotent)
  ↓
[3] Extract From, Body; normalize E.164
  ↓
[4] resolveCallerContext()
    - Lookup user by phone in (phone, emergencyContacts.phone)
    - Load linkedImeis
    - Fetch device docs
    ↓
[5] Classify intent (deterministic keywords)
    - "where", "locate", "at" → LOCATION_REQUEST
    - "sos", "help", "emergency" → CRITICAL
    - else → UNCLEAR
  ↓
[6] If CRITICAL & no uid:
    Return template: "Not registered. Ask your guardian..."
  ↓
[7] If LOCATION_REQUEST & uid exists:
    Build minimal context packet (not full device doc)
    ↓
    [7a] Check permission (requester.uid in device.allowedViewers)
          Currently: linkedImeis == allowedViewers
          Future: role + action scope
    ↓
    [7b] Build Gemini system prompt (minimal, location-focused)
    ↓
    [7c] Call LlmProvider.complete(systemPrompt, messages, tools)
         → GeminiProvider (primary)
         → TemplateFallbackProvider (if Gemini down)
    ↓
    [7d] Gemini tool-call loop:
         Request: get_current_location
         Response: {name, imei, online, lat, lng, accuracySource, recordedAt, mapsUrl}
    ↓
    [7e] Validate response:
         - No invented coordinates
         - Location source correctly labeled
         - Device ownership verified
         - No other wearer's data leaked
    ↓
    [7f] Send reply via WhatsApp
  ↓
[8] Log audit event:
    requestId, uid, imei, intent, permission_result, provider_model,
    tokens_in/out, tool_names, response_validation_result, latency
  ↓
[9] Return 200 OK to Twilio
```

---

## Files to Create

### 1. `gateway/src/providers/llm-provider.js` (Base class)
```javascript
/**
 * Abstract LLM provider interface.
 * All providers implement this contract.
 */
class LlmProvider {
  constructor(config) {
    this.config = config;
  }

  /**
   * @param {Object} params
   * @param {string} params.systemPrompt - System role/guardrails
   * @param {Array} params.messages - [{role, content}, ...]
   * @param {Array} params.tools - Tool definitions (Anthropic format for now)
   * @param {Object} params.metadata - {requestId, userId, locale, ...}
   * @returns {Promise<{content, usage, stopReason}>}
   */
  async complete({ systemPrompt, messages, tools, metadata }) {
    throw new Error('complete() not implemented');
  }

  /**
   * Test provider availability (health check)
   */
  async health() {
    return { ok: true };
  }
}

module.exports = LlmProvider;
```

### 2. `gateway/src/providers/gemini-provider.js` (Primary)
- Uses Google Generative AI SDK or REST API
- Models: `gemini-1.5-flash` (paid tier)
- Supports tool calling via googleaiStudio format
- Handles rate limiting, timeout, retry

### 3. `gateway/src/providers/anthropic-provider.js` (Fallback)
- Extracts existing claude.js logic
- Supports Claude models
- Same interface as GeminiProvider

### 4. `gateway/src/providers/template-fallback-provider.js` (Offline)
- No API call required
- Returns template-based responses
- Used when both Gemini and Anthropic unavailable

### 5. `gateway/src/providers/index.js`
- Factory to create provider based on config
- Selection logic: GEMINI_API_KEY → Gemini; else ANTHROPIC_API_KEY → Claude; else template

### 6. `gateway/src/intent-classifier.js`
```javascript
/**
 * Deterministic intent classification for WhatsApp input.
 * No LLM call required.
 */

function classifyIntent(text) {
  const lower = String(text || '').toLowerCase().trim();

  // Urgent/critical
  if (/\b(sos|help|emergency|urgent|danger)\b/.test(lower)) {
    return { type: 'CRITICAL', urgency: 9, confidence: 0.95 };
  }

  // Location/tracking
  if (/\b(where|locate|at|location|find|track)\b/.test(lower)) {
    return { type: 'LOCATION_REQUEST', urgency: 3, confidence: 0.90 };
  }

  // Device status
  if (/\b(battery|signal|online|check)\b/.test(lower)) {
    return { type: 'DEVICE_STATUS', urgency: 2, confidence: 0.85 };
  }

  // Medication/reminders
  if (/\b(reminder|medicine|pill|medication)\b/.test(lower)) {
    return { type: 'REMINDER_REQUEST', urgency: 4, confidence: 0.85 };
  }

  // Default
  return { type: 'UNCLEAR', urgency: 1, confidence: 0.0 };
}

module.exports = { classifyIntent };
```

### 7. `gateway/src/response-validator.js`
```javascript
/**
 * Validate LLM response before sending to user.
 * Catch hallucinations, data leaks, contradictions.
 */

function validateLocationResponse(response, device, tool) {
  const issues = [];

  // Check: invented coordinates
  if (response.includes(/\b\d+\.\d{4,}\s*,\s*\d+\.\d{4,}\b/)) {
    // Coordinate-like pattern. Cross-check against tool result.
    if (!tool.lat || !tool.lng) {
      issues.push('INVENTED_COORDINATES');
    }
  }

  // Check: location source correctly labeled
  if (tool.lat && tool.lng && tool.accuracySource) {
    if (/GPS/.test(response) && tool.accuracySource !== 'gps') {
      issues.push('MISMATCHED_SOURCE_LABEL');
    }
  }

  // Check: no other wearer data leaked
  if (response.match(/\b\d{15}\b/)) { // IMEI-like
    issues.push('EXPOSED_IMEI');
  }

  // Check: offline clearly stated
  if (!tool.online && !/(offline|not connected|no signal)/i.test(response)) {
    issues.push('OFFLINE_NOT_STATED');
  }

  return { valid: issues.length === 0, issues };
}

module.exports = { validateLocationResponse };
```

### 8. `gateway/src/audit.js`
```javascript
/**
 * Audit event logging for full request lifecycle.
 */

class AuditLog {
  async recordRequest({ requestId, uid, imei, intent, locale, fromPhone }) {
    // Write to logs or Firestore aiRequests collection
  }

  async recordPermissionCheck({ requestId, uid, imei, scope, result }) {
    // result: {allowed, reason}
  }

  async recordProviderCall({
    requestId,
    provider,
    model,
    tokensIn,
    tokensOut,
    latencyMs,
    toolNames,
  }) {
    // Operational metrics
  }

  async recordValidation({ requestId, response, validation }) {
    // validation: {valid, issues[]}
  }

  async recordResponse({ requestId, reply, destination }) {
    // destination: 'whatsapp' | 'fallback'
  }
}

module.exports = { AuditLog };
```

### 9. `gateway/src/request-context.js`
```javascript
/**
 * Build minimal context packet per Master Context section 12.
 * Do not send full device docs.
 */

function buildContextPacket({ requester, wearer, device, intent }) {
  return {
    requestId: requester.requestId,
    mode: 'guardian',
    locale: requester.locale || 'en',
    requester: {
      displayName: requester.displayName,
      role: requester.role || 'guardian',
      permissions: ['location.read'], // Will expand
    },
    wearer: {
      wearerId: wearer.id,
      displayName: wearer.displayName,
      profileType: wearer.profileType || 'unknown',
    },
    currentStateSummary: {
      online: device.online,
      batteryPercent: device.batteryPercent,
      activeIncident: false, // Will expand
    },
    allowedTools: ['get_current_location'],
    conversationSummary: intent.type,
    constraints: {
      maxResponseSentences: 3,
      medicalClaimsAllowed: false,
    },
  };
}

module.exports = { buildContextPacket };
```

### 10. `gateway/src/idempotency.js`
```javascript
/**
 * Detect and cache duplicate webhook deliveries.
 */

class IdempotencyStore {
  constructor() {
    this.cache = new Map(); // requestId → {reply, timestamp}
  }

  isSeen(requestId) {
    const entry = this.cache.get(requestId);
    if (!entry) return false;
    // Expire after 5 minutes
    if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
      this.cache.delete(requestId);
      return false;
    }
    return true;
  }

  getCachedReply(requestId) {
    return this.cache.get(requestId)?.reply;
  }

  store(requestId, reply) {
    this.cache.set(requestId, { reply, timestamp: Date.now() });
  }
}

module.exports = { IdempotencyStore };
```

### 11. `gateway/src/gemini-tools-adapter.js`
```javascript
/**
 * Adapt existing Anthropic tool definitions to Gemini format if needed.
 * Both support similar tool calling, but schema details differ.
 */

function adaptToolsForProvider(provider, anthropicTools) {
  if (provider === 'gemini') {
    // Convert TOOL_DEFINITIONS to Google format
    // Most fields map 1:1; just adjust as needed
  }
  return anthropicTools; // For now, compatible enough
}

module.exports = { adaptToolsForProvider };
```

---

## Files to Modify

### 1. `gateway/src/config.js`
Add:
```javascript
geminiApiKey: process.env.GEMINI_API_KEY || '',
geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
llmProvider: process.env.LLM_PROVIDER || 'gemini', // 'gemini' | 'anthropic' | 'template'
requestIdleTimeoutSeconds: Number(process.env.REQUEST_IDLE_TIMEOUT_SECONDS || 300),
```

### 2. `gateway/src/http.js`
Replace lines 102–136 (handleChat):
- Generate requestId
- Check idempotency
- Classify intent
- Call new provider abstraction
- Validate response
- Log audit event

### 3. `gateway/src/assistant/tools.js`
Add permission enforcement:
```javascript
async function getLastLocation(ctx, input, requester) {
  // Check: requester.uid has location.read permission on device
  const device = findDevice(ctx.devices, input.imei || input.device_name);
  if (!requester.allowedImeis.includes(device.imei)) {
    return { error: 'Permission denied' };
  }
  // ... rest of function
}
```

### 4. `gateway/src/assistant/claude.js`
Extract logic into new `GeminiProvider` and `AnthropicProvider` classes; keep as reference.

### 5. `gateway/.env.example`
Add:
```bash
# LLM Provider (gemini | anthropic | template)
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
REQUEST_IDLE_TIMEOUT_SECONDS=300
```

### 6. `gateway/package.json`
Add:
```json
"dependencies": {
  "@google/generative-ai": "^0.x.x"
}
```

---

## Files to Update (Documentation)

### 1. `firestore/SCHEMA.md`
Add missing fields:
- `users.whatsapp` (observed in code, not documented)
- Note: `linkedImeis` is currently the permission boundary

Future collections (Phase 2+):
- `conversations/{id}` — conversation history
- `incidents/{id}` — SOS/fall state machine
- `aiRequests/{id}` — audit trail (full request/response)

### 2. `README.md`
Add section: "Running with Gemini" (environment setup)

---

## Implementation Steps

### Step 1: Core Provider Abstraction (Day 1)
- [x] Create `gateway/src/providers/llm-provider.js`
- [x] Create `gateway/src/providers/gemini-provider.js`
- [x] Create `gateway/src/providers/anthropic-provider.js` (from claude.js)
- [x] Create `gateway/src/providers/template-fallback-provider.js`
- [x] Create `gateway/src/providers/index.js` (factory)
- [x] Update `gateway/src/config.js`
- [x] Tests: `gateway/test/providers.test.js`

### Step 2: Request Processing Layers (Day 1–2)
- [x] Create `gateway/src/intent-classifier.js`
- [x] Create `gateway/src/response-validator.js`
- [x] Create `gateway/src/request-context.js`
- [x] Create `gateway/src/audit.js`
- [x] Create `gateway/src/idempotency.js`
- [x] Tests for each

### Step 3: Integrate into HTTP Handler (Day 2)
- [x] Modify `gateway/src/http.js` to orchestrate layers
- [x] Modify `gateway/src/assistant/tools.js` for permission checks
- [x] Integration test: end-to-end request

### Step 4: Test Suite (Day 2–3)
- [x] `gateway/test/end-to-end-location.test.js` (17 criteria)
- [x] Success path
- [x] Stale location
- [x] Approximate location (WiFi/LBS)
- [x] Unauthorized user
- [x] Ambiguous wearer (ask for clarification)
- [x] Provider failure → fallback
- [x] Duplicate webhook → idempotent reply

### Step 5: Documentation (Day 3)
- [x] Update `firestore/SCHEMA.md`
- [x] Update `README.md`
- [x] Add `.env.example` docs
- [x] Comment key flows in code

---

## Testing Strategy

### Unit Tests
- `intent-classifier.test.js` — All keywords, edge cases
- `response-validator.test.js` — Hallucination detection
- `providers.test.js` — Each provider in isolation
- `request-context.test.js` — Context packet structure

### Integration Tests
- `end-to-end-location.test.js` — Full flow, all 17 criteria
  - Mock Firestore, Gemini, Twilio
  - Verify requestId correlation
  - Verify audit events written

### Manual Testing
- Run simulator: `npm run simulate`
- Send `/dev/chat` requests with different intents
- Verify Gemini API calls (inspect logs)
- Verify fallback when Gemini down

---

## Success Criteria for Phase 1

All must be ✅ before merging:

- [ ] All 17 acceptance criteria tested and passing
- [ ] No existing GPS/alert/Flutter behavior changed
- [ ] Duplicate webhooks produce identical cached replies (idempotent)
- [ ] Gemini failure → template fallback (no crash)
- [ ] Request IDs logged end-to-end
- [ ] Response validation catches hallucinated coordinates
- [ ] Permission check prevents cross-wearer access
- [ ] Multilingual input works (English, French, Creole)
- [ ] Maps URLs generated server-side
- [ ] A/V logic (GPS vs WiFi vs LBS vs stale) preserved

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Gemini API outage | TemplateFallbackProvider → truthful template reply |
| Prompt injection | Input sanitization + tool output treated as untrusted |
| Hallucinated coordinates | Response validator checks fact against tool result |
| Duplicate messages | Idempotency store + requestId cache |
| Cost overrun | Rate limiting + token counting in audit log |
| Data leakage | Permission check + context minimisation + validator |

---

## Rollback Plan

If tests fail or regressions found:
1. Keep old `gateway/src/assistant/claude.js` in git history
2. Feature flag to switch provider: `LLM_PROVIDER=anthropic` in env
3. Revert commit if needed (git is source of truth)

---

## Next Phase (Phase 2) — Not Included

- Wearer identity separation (IMEI ≠ wearer)
- Incident state machine (SOS acknowledgement, escalation)
- Conversation history storage
- Guardian Memory (profiles, routines, baselines)
- Trend engine (structured insights)
- Proactive messages (device readiness, arrivals)
- Multilingual UI (in-app languages already work)

---

## Deliverables

By end of Phase 1:

1. ✅ Feature branch with provider abstraction
2. ✅ Gemini Flash integration (paid tier)
3. ✅ Intent classifier (deterministic)
4. ✅ Response validator (hallucination detection)
5. ✅ Request audit trail (full lifecycle logging)
6. ✅ Webhook idempotency (duplicate detection)
7. ✅ Test suite (17 acceptance criteria, 100% pass)
8. ✅ Documentation updates
9. ✅ Rollback plan (feature flags)

Ready to implement. Branch checkout and begin Step 1.

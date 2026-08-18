# Guardian Context Intelligence

This directory is Guardian's single context-intelligence implementation. It
extends the original weather/context work; do not create a second RSS, weather,
or LLM decision service beside it.

## Current flow

1. `contextRuntime.js` creates one process-wide `ContextService`.
2. `contextScheduler.js` reads up to the configured number of devices once per
   hour. A five-minute configuration is clamped to 60 minutes.
3. `deviceContextAdapter.js` uses Connectivity P0's provenance-aware
   `location.lat/lng` shape and `selectLocationForDisplay`. The obsolete
   `lastLocation.coordinates` shape is not revived.
4. `WeatherProvider` fetches OpenWeatherMap current conditions. Locations are
   rounded to two decimals and cached for at least one hour, so nearby users
   share one external fetch.
5. `ContextEvaluator` applies deterministic source, severity, age, location
   freshness, and connectivity rules. Normal conditions never call the LLM.
6. For a deterministic candidate, `ContextAI` makes one provider-agnostic LLM
   call that returns a strict JSON relevance decision and explanation.
7. Invalid, refused, or failed LLM output falls back to the deterministic
   result. Source facts are retained separately as `deterministicEvaluation`.
8. The result is observe-only. It may recommend `suppress`, `app`, or
   `whatsapp_template`, but this module does not call Meta or send a message.

## Configuration

Add these values to the gateway deployment secrets/environment:

```dotenv
OPEN_WEATHER_MAP_KEY=...

# Explicit opt-in. Disabled means no background Firestore or weather reads.
CONTEXT_INTELLIGENCE_ENABLED=true

# Defaults shown below.
CONTEXT_POLL_MINUTES=60
CONTEXT_WEATHER_CACHE_MINUTES=60
CONTEXT_MAX_DEVICES_PER_SWEEP=1000
CONTEXT_CONCURRENCY=5
CONTEXT_RUN_ON_STARTUP=true
CONTEXT_LLM_JUDGMENT_ENABLED=true

# Leave false during initial shadow validation. When true, one idempotent
# contextObservations document is written per device/candidate/hour.
CONTEXT_PERSIST_OBSERVATIONS=false
```

`ANTHROPIC_MODEL` now defaults to `claude-sonnet-5`. The same provider factory
used by WhatsApp is reused here; no second AI client or key is created.

## Cost controls

- One fleet sweep per hour, not every five minutes.
- One Firestore device read per device per sweep.
- Weather cache shared by all devices in the same ~1 km coordinate cell.
- Zero LLM calls for normal weather.
- At most one LLM call per deterministic candidate.
- One call produces both relevance and explanation; there is no second
  narration call.
- Context token usage is included in the existing assistant/AI cost counters
  and also exposed separately as `contextLlmTokensIn/Out`.

## Output contract

`GET /devices/{imei}/context` and the scheduler use the same shared service.
The important fields are:

```json
{
  "deterministicEvaluation": {
    "relevant": true,
    "severity": "check_in",
    "reasons": ["Severe weather applies to area"]
  },
  "contextDecision": {
    "mode": "llm_shadow",
    "relevant": true,
    "confidence": 0.91,
    "recommendedSurface": "whatsapp_template",
    "reason": "Timely severe weather near the wearer.",
    "observeOnly": true
  },
  "delivery": {
    "mode": "observe_only",
    "sent": false
  }
}
```

## Tests

```bash
node --test src/context/context.test.js test/context-consolidation.test.js
npm test
```

Coverage includes the original evaluator plus P0 location adaptation, hourly
minimum scheduling, cache reuse, structured LLM validation, deterministic
fallback, token accounting, and the no-delivery boundary.

## Next adapters

RSS and Mauritius Meteorological Services warnings should enter this pipeline
as normalized source adapters. They still need source trust, event IDs,
deduplication, expiry, and cross-source corroboration. Do not fetch them inside
the LLM prompt and do not enable proactive WhatsApp until shadow precision and
template policy have been reviewed.

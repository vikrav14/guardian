# Context Intelligence Phase 1 Implementation

Guardian's context intelligence transforms the app from location-only tracking to context-aware family safety. Phase 1 adds weather awareness and deterministic relevance evaluation.

## What's Built

**Three core modules** enable context intelligence:

### 1. WeatherProvider (`weatherProvider.js`)
- Fetches real-time weather from OpenWeatherMap API
- 30-minute intelligent caching (location-based)
- Identifies severe weather: thunderstorms, extreme temps (>35°C or <5°C), rain/snow
- Returns normalized schema: temperature, condition, alerts, severity level

**Key methods:**
- `getWeather(lat, lng, placeName)` — Async weather fetch with cache
- `_isSevereWeather(condition, temp)` — Deterministic severity classification
- `_extractAlerts(condition, temp)` — Human-readable alert extraction

### 2. ContextEvaluator (`contextEvaluator.js`)
- Deterministic relevance rules (no AI yet)
- Evaluates if weather applies to a specific person
- Age-based adjustments (child, teenager, adult, elderly)
- Location freshness confidence (≤15 min fresh, >30 min stale, between uncertain)

**Key methods:**
- `evaluateWeatherRelevance(weather, person, device, location)` — Full evaluation
- Severity levels: none, info, useful_information, check_in, urgent

**Smart reasoning:**
- Severe weather always relevant for kids
- Heat alerts only for vulnerable (child/elderly)
- Stale location adds "uncertainty" flags
- Offline device decreases confidence

### 3. ContextSchemas (`contextSchemas.js`)
- JSON Schema validation for data quality
- Schemas: `weatherSchema`, `contextEvaluationSchema`, `deviceContextSchema`
- `validateSchema(obj, schema)` returns `{valid, errors[]}`

### 4. ContextService (`contextService.js`)
- Orchestrates weather + evaluator + validation
- **Observe-only mode**: logs proposed alerts without notifying users
- Full error handling with graceful fallback

**Key methods:**
- `getDeviceContext(device, person, location)` — Full pipeline
- `getObservationLog(limit)` — View logged observations
- `getStats()` — Service health metrics

## Setup

### 1. Configure OpenWeatherMap API

```bash
# Add to gateway/.env
OPEN_WEATHER_MAP_KEY=your_api_key_here
```

Get free tier at https://openweathermap.org/api — 1,000 calls/day.

### 2. Run Unit Tests

```bash
cd gateway
npm test -- src/context/context.test.js
```

Expected output: 11 tests pass, covering:
- Weather API failure handling
- Severe weather detection
- Age-based relevance
- Cache expiration
- Schema validation

### 3. Integration Endpoint

HTTP GET `/devices/{imei}/context` returns:

```json
{
  "device": {
    "online": true,
    "lastSeenAt": "2026-08-03T14:32:00Z",
    "batteryPercent": 80
  },
  "location": {
    "lat": -20.16,
    "lng": 57.50,
    "placeName": "Grand Baie",
    "freshnessMinutes": 2,
    "accuracyClass": "good"
  },
  "weather": {
    "temperature": 28,
    "condition": "Thunderstorm",
    "alerts": [
      {
        "type": "severe_weather",
        "message": "Thunderstorm warning",
        "urgency": "high"
      }
    ],
    "severity": "severe"
  },
  "contextEvaluation": {
    "relevant": true,
    "severity": "check_in",
    "message": "Thunderstorm may affect Dexter's area (Grand Baie). Dexter appears to be there and the pendant is online.",
    "reasons": ["Severe weather applies to area", "Child may need shelter/supervision"],
    "uncertainty": []
  },
  "fetchedAt": "2026-08-03T14:32:00Z"
}
```

## Observe-Only Mode

During Phase 1, context intelligence logs proposed alerts **without sending notifications**. This allows Guardian to:

1. **Collect real data** on weather patterns in Mauritius
2. **Measure false-positive rate** before impacting users
3. **Refine rules** based on actual device behavior
4. **Understand the cost** of weather monitoring

Access logs at `/devices/{imei}/context` (logs last 50 observations by default):

```javascript
contextService.getObservationLog(50)
// Returns: [{timestamp, person, severity, message, deviceState, ...}, ...]
```

## Phase 1 Deliverables

- ✅ **Monday**: Weather API integration (weatherProvider.js)
- ✅ **Tuesday**: Deterministic relevance rules (contextEvaluator.js)
- ✅ **Wednesday**: Schema validation (contextSchemas.js)
- 🔨 **Thursday**: Claude explanation layer (contextAI.js)
- 🔨 **Friday**: Dashboard context card + tests

## Phase 2+ Roadmap

**Phase 2: Claude Explanations**
- Call Claude with structured weather facts
- Natural language context explanations
- Hallucination guards (validate against schema)

**Phase 3: News/Events Integration**
- RSS feed monitoring for local events
- Relevance evaluation (concert near device? school event?)
- Combined weather + news recommendations

**Phase 4: Proactive Notifications**
- Guardian receives: "Severe thunderstorm at Dexter's school. Device online, battery 80%."
- Suggests actions: "Check in with Dexter" or "Enable voice monitor to listen"

**Phase 5: Geofence + Context**
- Smart geofences that know weather
- "Alert me if they leave safe zone DURING heavy rain"

**Phase 6: Family Insights**
- Historical patterns: "Dexter is usually indoors on rainy days"
- Anomaly detection: "Unusual location + bad weather = check in"

## Error Handling

All modules are defensive:

1. **WeatherProvider**: Returns empty weather on API failure (never crashes)
2. **ContextEvaluator**: Handles missing person/device/location gracefully
3. **ContextService**: Catches all errors, returns minimal safe context
4. **Schema validation**: Logs warnings, doesn't block responses

Example fallback when API unreachable:
```json
{
  "weather": {
    "condition": "unknown",
    "alerts": [],
    "severity": "unknown",
    "confidence": 0.0
  },
  "contextEvaluation": {
    "relevant": false,
    "severity": "none",
    "message": "Could not evaluate context at this time"
  }
}
```

## Testing Locally

### Mock Weather Response

Test with hardcoded weather (without API key):

```javascript
const evaluator = new ContextEvaluator();
const weather = {
  temperature: 28,
  condition: 'Thunderstorm',
  alerts: [{type: 'severe_weather', message: 'Thunderstorm', urgency: 'high'}],
  severity: 'severe'
};
const person = {displayName: 'Dexter', age: 8};
const device = {online: true, batteryPercent: 80};
const location = {lat: -20.16, lng: 57.50, placeName: 'School', freshnessMinutes: 5};

const result = evaluator.evaluateWeatherRelevance(weather, person, device, location);
console.log(result.relevant); // true
console.log(result.severity); // 'check_in'
```

### Production Readiness

Before deploying observe-only mode to production:

1. ✅ All tests pass
2. ✅ Weather API key configured
3. ✅ Observation log size capped (1000 entries)
4. ✅ Cache TTL optimized (30 min)
5. ✅ Error handling tested (API down, invalid location, etc.)

## Architecture Notes

**Why deterministic rules before AI?**
- Fast: No LLM latency
- Predictable: Reproducible decisions
- Auditable: Clear reasoning in logs
- Cheaper: No per-request LLM cost for common cases

**Why observe-only for Phase 1?**
- Collect real Mauritius weather data
- Measure false-positive rate
- Learn how devices move during weather events
- Build confidence before notifying guardians

**Cache strategy:**
- 30-minute TTL per location (lat/lng to 2 decimal places)
- Cold start: first query for a location pays API cost
- Subsequent queries within window are free
- ~50-100 active locations during business hours

## See Also

- `/gateway/src/context/` — All context modules
- `CLAUDE.md` — Protocol reference for V28C/V52 devices
- `/firestore/SCHEMA.md` — Device/location data structure

# Guardian Context Intelligence

This directory is Guardian's single context-intelligence implementation. It
extends the original weather/context work; do not create a second RSS, weather,
or LLM decision service beside it.

## Current flow

1. `contextRuntime.js` creates one process-wide `ContextService`.
2. `contextScheduler.js` reads up to the configured number of devices once per
   hour. A five-minute configuration is clamped to 60 minutes.
3. `capAlertProvider.js` polls the official Mauritius Meteorological Services
   Common Alerting Protocol (CAP) feed on its own five-minute schedule. RSS is
   only an index; every entry is resolved to its full CAP XML document before
   it can become a safety fact.
4. `defiMediaRssProvider.js` polls the Defi Media site-wide RSS feed at most
   once per hour. It deduplicates articles and applies a conservative local
   safety prefilter. This media source remains corroboration-only: it does not
   run the LLM, match devices, write Firestore, or deliver notifications.
5. `deviceContextAdapter.js` uses Connectivity P0's provenance-aware
   `location.lat/lng` shape and `selectLocationForDisplay`. The obsolete
   `lastLocation.coordinates` shape is not revived.
6. `WeatherProvider` fetches OpenWeatherMap current conditions. Locations are
   rounded to two decimals and cached for at least one hour, so nearby users
   share one external fetch.
7. `ContextEvaluator` applies deterministic source, severity, age, location
   freshness, and connectivity rules. Normal conditions never call the LLM.
8. For a deterministic candidate, `ContextAI` makes one provider-agnostic LLM
   call that returns a strict JSON relevance decision and explanation.
9. Invalid, refused, or failed LLM output falls back to the deterministic
   result. Source facts are retained separately as `deterministicEvaluation`.
10. The result is observe-only. It may recommend `suppress`, `app`, or
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

# Official MMS CAP adapter. Disabled until explicitly enabled.
CONTEXT_CAP_ENABLED=false
CONTEXT_CAP_FEED_URL=https://cap-sources.s3.amazonaws.com/mu-mms-en/rss.xml
CONTEXT_CAP_POLL_MINUTES=5
CONTEXT_CAP_MAX_ITEMS=50
CONTEXT_CAP_RUN_ON_STARTUP=true
CONTEXT_CAP_EVALUATE_DEVICES=true

# Optional idempotent source-fact audit documents. Leave false for the first
# live shadow run if no additional Firestore writes are wanted.
CONTEXT_CAP_PERSIST_EVENTS=false

# Defi Media RSS shadow adapter. Disabled until explicitly enabled. Polling
# is clamped to a minimum of 60 minutes.
CONTEXT_DEFIMEDIA_ENABLED=false
CONTEXT_DEFIMEDIA_FEED_URL=https://defimedia.info/rss.xml
CONTEXT_DEFIMEDIA_POLL_MINUTES=60
CONTEXT_DEFIMEDIA_MAX_ITEMS=100
CONTEXT_DEFIMEDIA_MAX_AGE_HOURS=24
CONTEXT_DEFIMEDIA_RUN_ON_STARTUP=true
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
- The official feed uses HTTP validators when supplied and only re-evaluates
  devices after a source fact changes. CAP-triggered evaluation skips a second
  weather fetch.
- Defi Media uses HTTP validators when available, processes only changed feed
  items, makes zero LLM calls, performs zero device sweeps, and writes no
  Firestore documents in this phase.

## Official MMS source policy

- Authority: Mauritius Meteorological Services, registered through the
  [WMO Register of Alerting Authorities](https://alertingauthority.wmo.int/authorities.php?recId=185).
- Feed: `https://cap-sources.s3.amazonaws.com/mu-mms-en/rss.xml`.
- Standard: CAP 1.2. Only `Actual`, non-cancelled, currently effective and
  unexpired documents are eligible.
- Geography: CAP polygons and circles are exact. An explicit Mauritius-wide
  area description is accepted only for a wearer on the main island. Marine
  warnings without geometry are not applied merely because the wearer is in
  Mauritius; they require future coastal/activity context.
- Lifecycle: content hashes deduplicate updates. A missing item needs two
  complete successful feed snapshots before being treated as withdrawn. CAP
  update/cancel references retire the superseded warning immediately.
- Delivery: source ingestion, persistence and relevance judgment remain
  observe-only. This code has no Meta/WhatsApp send call.

Operational inspection:

```bash
node scripts/inspect-context-sources.js
node scripts/inspect-context-sources.js --json
```

With strict admin authentication configured, `GET /ops/context-sources`
returns scheduler/source health without exposing a delivery action.

## Defi Media shadow-source policy

- Feed: `https://defimedia.info/rss.xml`.
- Trust: `local_media`, never `official_authority`. A news report cannot
  override CAP, watch telemetry, safe-zone evidence, or emergency services.
- Schedule: one immediate startup poll followed by polling at most hourly.
- Collection: feed metadata only. Guardian does not scrape or fetch article
  pages in this phase.
- Prefilter: deterministic French/Kreol-friendly keyword classes for serious
  road disruption, fire, flooding/landslide, public safety, school closure,
  infrastructure disruption, health hazards, and vulnerable missing persons.
  Politics, interviews, blogs, sport, entertainment, magazine, and economy
  sections are excluded.
- Geography: known Mauritius place names are extracted as unverified mentions,
  not coordinates. No user impact is inferred until a later, fail-closed place
  resolver and proximity policy are reviewed.
- Delivery: every record has `deliveryEligible=false` and `deliverySent=false`.
  The scheduler makes no LLM call, device sweep, Firestore write, or Meta call.

## Output contract

`GET /devices/{imei}/context` and the scheduler use the same shared service.
The important fields are:

```json
{
  "deterministicEvaluation": {
    "relevant": true,
    "severity": "check_in",
    "reasons": ["Mauritius Meteorological Services: Heavy Rain Warning (severe, expected)"]
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
minimum scheduling, CAP XML normalization and geometry, withdrawal/expiry,
five-minute source scheduling, cache reuse, structured LLM validation,
deterministic fallback, token accounting, and the no-delivery boundary.

## Next adapters

Stable MMS warning pages can be added later as a monitored fallback if the CAP
feed proves incomplete. The next Defi Media phase is a reviewed place resolver
and fail-closed impact matcher. Local media RSS must remain corroboration-only,
with separate trust labels and no ability to override an official CAP fact. Do
not fetch either inside the LLM prompt and do not enable proactive WhatsApp
until shadow precision and template policy have been reviewed.

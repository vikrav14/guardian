# Dashboard priority updates

The wearer’s weather slot can show a recent, applicable public-safety report.
It retains the existing weather artwork, a manual weather shortcut, and the same
responsive slot height. It never rotates automatically. `View update` explains
the location match, publication/source-check times and links to the publisher.
Nothing here creates SOS/fall alerts, WhatsApp messages, push notifications or
watch commands. A local report is not evidence that the wearer is affected.

## Eligibility

- **Défi Media RSS:** trusted article URL, recent publication, one recognized
  locality as a headline dateline, explicit ongoing wording, and an allowlisted
  event: active crime/public-safety incident, fire, flooding/landslide, road
  closure or utility disruption. Arrests, investigations, retrospective stories,
  resolved incidents, rumours, negation, questions and ambiguous locations are
  excluded. Headline wording is retained; Guardian does not invent a summary.
- **MMS CAP:** Actual/Public Alert or Update, Observed/Likely certainty,
  Immediate/Expected urgency, Moderate/Severe/Extreme severity, current effective
  window and applicable published geometry/main-island area. Test, cancelled,
  expired and unsupported marine-only reports stay hidden.
- **Watch location:** GPS or a known Wi-Fi/LBS accuracy of at most 1 km, younger
  than 15 minutes. Qualified Home Wi-Fi can supply its saved anchor only until
  its own two-minute evidence expires. Remembered Home alone never establishes
  exposure and prevents falling back to an earlier trip fix.
- **Proximity:** a reviewed locality geocode is an area centre, not an incident
  coordinate. Use conservative radii (1.5–2.5 km by event type), including the
  watch’s uncertainty. District membership alone never qualifies a report.
  Approximate CAP fixes require the centre and uncertainty perimeter samples
  to match the published area; this is conservative sampling, not a precise
  polygon-buffer proof.
- **Freshness:** media source checks expire after 30 minutes, CAP after 10.
  Reports expire after 90–180 minutes depending on type, CAP at its source
  expiry. The earliest source, event or location deadline wins. Feed errors
  suppress candidates at the next projection pass; an offline/restarted gateway
  cannot extend a previously issued lease. The app also expires leases locally.

Rank by severity, then official source on ties, then publication time. Show up
to five reports, with manual navigation; keep one media event type per locality.
Current-feed membership excludes removed media stories. Re-dated article IDs
and identical headlines keep their earliest known publication during provider
lifetime. This is not semantic deduplication across different headlines or a
durable cross-restart incident ledger. The existing observation event store is
separate; its broad keyword matches never directly become dashboard cards.

## Access and data

Server-owned projection: `devices/{imei}/localUpdates/current` (schema version 1).
It contains only the matched display records and the location evidence used.
Firestore requires active Family/Care service access and the `location` grant.
Alerts-only, expired, revoked and unrelated members cannot read it. Clients
cannot create, alter or delete these documents.

The Flutter stream clears data on sign-out/unlink/error. A different wearer,
changed fix, permission loss, conflicting Home evidence or expired lease hides
the card. Weather returns; an empty state never claims the area is safe.

## Operation and staged rollout

Default disabled. Deploy rules and updated app first, then the gateway version.
For a reviewed pilot configure:

```dotenv
PRIORITY_UPDATES_ENABLED=true
PRIORITY_UPDATES_IMEIS=<comma-separated pilot watch IMEIs>
CONTEXT_DEFIMEDIA_ENABLED=true
CONTEXT_CAP_ENABLED=true
```

Invalid pilot IDs disable the scheduler instead of silently enabling the fleet.
An empty pilot list enables paged fleet processing: at most 100 device documents
each minute, only while potentially eligible reports exist. A 200-watch fleet
therefore takes about two minutes per pass, in addition to feed latency. The
shared Défi poll has a 15-minute minimum interval; CAP defaults to five minutes.
This is supplementary awareness, not an emergency dispatch or real-time feed.

The existing Google geocoder is reused, with an eight-second request timeout.
Both successful and failed place resolutions are cached across wearer passes.
There are no new per-wearer RSS fetches or model calls. Device reads and changed
projection writes count toward existing Firestore metrics. The separate shadow
exposure scheduler has its own costs; it is not required for this display
(`CONTEXT_DEFIMEDIA_EVALUATE_DEVICES=false` can disable that optional sweep).

For rollback, disable `PRIORITY_UPDATES_ENABLED` and restart the gateway.
Existing cards expire within their remaining lease (at most 15 minutes; qualified
Home cards at most two). For immediate removal, an operator can replace the
affected `localUpdates/current` documents with empty version-1 projections.
Do not publish synthetic test reports into production wearer documents.

Pilot acceptance: verify a genuine matching report, no report at another area,
returning Home, expiry while offline, weather shortcut/artwork, the source link,
large text, Family revocation and source-outage fallback. Review actual feed
coverage before widening eligibility: headline-only rules intentionally miss
some relevant stories, and geocoded locality names can be ambiguous.

## Validation

- Gateway: `npm test` includes eligibility, freshness, Home, ranking, provider
  withdrawal/re-dating, default-off/pilot/idempotence and source-race tests.
- App: `flutter analyze` and `flutter test`, including production-widget weather
  fallback, stable sizing, wearer switching, expiry without a Firestore event,
  error/revocation clearing and 320-pixel layouts at 1×/2× in light/dark.
- Rules: `npm test` in `firestore` runs the authorization emulator suite.
- Optional local screenshot: set `GUARDIAN_RENDER_PRIORITY=1` and
  `DASHBOARD_PREVIEW_FONT` to a local TTF, then run
  `flutter test test/priority_updates_test.dart`. The synthetic example is saved
  to `apps/mobile/build/priority-preview/priority-card.png`.

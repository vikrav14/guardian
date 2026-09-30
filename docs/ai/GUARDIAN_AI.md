# Guardian Intelligence

## Purpose

Guardian Intelligence is the shared architecture for AI-assisted and predictive capabilities across Guardian.

AI is an interpretation layer over Guardian evidence. It is not an authoritative source for safety, location, health, or device facts.

## Core contract

1. **Evidence before claims.** AI must not manufacture Guardian facts. Every safety-relevant statement must be grounded in identifiable evidence supplied by Guardian.
2. **Deterministic facts remain authoritative.** SOS/fall events, timestamps, device state, battery, connectivity, Home state, sensor readings and verified location come from Guardian services, not an LLM.
3. **Predictions are labelled.** Projected routes, likely destinations, routine matches and other inferred states must never be presented as confirmed facts.
4. **Unknown stays unknown.** Missing, stale or conflicting evidence must not be filled in by the model.
5. **No diagnosis.** Wellness intelligence may describe readings and trends but must not diagnose medical conditions or determine that a wearer is safe.
6. **Source and freshness matter.** External context such as RSS must retain source, publication time, extraction confidence and expiry.
7. **AI failure must not break safety features.** Core alerts and deterministic Guardian functions continue without the AI provider.

## Information flow

```text
Guardian/external evidence
        |
        v
deterministic processing
        |
        v
structured evidence/context
        |
        +--> relevance / prediction engines
        |
        v
AI context builder
        |
        v
AI interpretation
        |
        v
claim / notification policy
        |
        +--> App
        +--> WhatsApp
        +--> Context Slot
```

The context builder should provide only evidence relevant to the current task. Do not send complete profile histories or large raw GPS histories to an LLM when derived data is sufficient.

## User communication levels

### Guardian Alert
Reserved for authoritative safety events such as SOS and confirmed Guardian alert events. AI may add context, but must not create the alert.

### Guardian AI Insight
A normal, non-alarm notification for useful inferred/contextual information such as:
- relevant local disruption;
- journey pattern/deviation;
- projected-route context;
- unusual duration or routine observation;
- non-diagnostic wellbeing/activity trend.

AI Insights must use calm language and must not imply danger solely because something is unusual or nearby.

### Guardian Update
Low-priority informational content such as routine summaries, weather and general context. Usually app/context-first.

Turning off AI/context notifications must not disable Guardian safety alerts.

## External context / RSS contract

External feeds are inputs, not Guardian truth. Processing should create a structured context event containing, where available:

- source and canonical source URL;
- source publication time;
- ingestion time;
- concise factual summary;
- category;
- extracted place/entity references;
- resolved geographic area/coordinates separately from AI extraction;
- location confidence;
- relevance reasons;
- expiry;
- deduplication identity.

For Défi Media, the first target is to filter general news into Guardian-relevant context such as road disruption, flooding, fire, major traffic disruption, weather/local emergency information and other location-relevant safety context.

An article mentioning the same town as a wearer does **not** prove that the wearer is at, near, or affected by the reported event.

## Notification policy

Before sending a Guardian AI Insight, the policy layer should consider:

- relevance threshold;
- evidence confidence;
- evidence/source freshness;
- profile/current journey spatial relevance;
- duplicate/same-event suppression;
- cooldown/rate limits;
- whether the information is still actionable;
- user notification preferences.

A relevant item may appear in the Context Slot without necessarily generating a push notification.

## Feature registry

| Domain | Capability | Evidence authority | AI role |
| --- | --- | --- | --- |
| Incident | SOS/fall summary | Guardian event pipeline | Explain/summarise |
| Incident | Photo analysis | Incident photo | Describe with uncertainty |
| Journey | Journey summary | Journey engine | Explain |
| Journey | Projected route | Pattern/prediction engine | Explain prediction |
| Journey | Route deviation | Pattern engine | Explain difference |
| Journey | Expected-return pattern | Historical journey engine | Explain typical range |
| Context | Défi Media RSS | Source + context processor | Extract/classify/summarise |
| Context | Weather/local context | External source | Summarise relevance |
| Wellbeing | Activity trends | Guardian history | Explain trend |
| Wellbeing | Wellness trends | Guardian readings | Explain, never diagnose |
| Assistant | App/WhatsApp questions | Context builder | Natural-language response |

## Efficiency rules

- Prefer derived summaries/patterns over raw histories.
- Cache stable derived intelligence where appropriate.
- Process each external item once where possible, then reuse its structured representation across profiles.
- Perform deterministic filtering before invoking an LLM where practical.
- Invoke AI only when it adds semantic extraction, interpretation or useful natural-language explanation.
- Keep provider-specific model calls behind a shared intelligence interface.

## Implementation direction

Code should converge on a shared `intelligence` boundary rather than embedding provider prompts and safety rules independently in RSS, journeys, incidents, wellbeing and WhatsApp.

Suggested logical modules:

```text
intelligence/
  core/
    evidence
    context
    claims
    confidence
    notification-policy
  incident/
  journeys/
  wellbeing/
  external-context/
  assistant/
```

The exact physical paths may follow the existing gateway/application structure; the important constraint is one shared contract and reusable core.

## Initial acceptance criteria

The first implementation using this contract (Défi Media contextual intelligence) should demonstrate that:

1. an RSS item is converted to a reusable structured context event;
2. irrelevant general news can be filtered without notifying a Guardian user;
3. geographic extraction and Guardian spatial matching are separate steps;
4. stale/duplicate context does not generate repeated notifications;
5. a relevant event can appear as a **Guardian AI Insight**, not a Guardian Alert;
6. notification wording states uncertainty where relevance is inferred;
7. source attribution remains available to the user;
8. disabling AI/context notifications cannot suppress SOS/fall alerts;
9. the design can later accept route projection without introducing a second AI policy stack.

## Future additions

New intelligence capabilities should be registered here and reuse the evidence, context, claims and notification policy rather than creating independent AI rules.

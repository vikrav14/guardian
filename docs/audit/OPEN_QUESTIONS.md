# Guardian — Open Questions for Owner Review

**Audit Date:** 2026-07-29  
**Scope:** Questions blocking documentation finalization; requires owner decision or confirmation

## Hardware & Device Strategy

1. **V28C deprecation status**
   - Is V28C still supported, or fully deprecated in favor of V52?
   - Should documentation maintain separate V28C provisioning guides, or archive them?
   - Are there real devices in the field still running V28C that need support?
   - Implication: Determines scope of hardware documentation and support burden.

2. **V52 as primary device**
   - Is V52 the only recommended device going forward?
   - Are V46 and V48 still supported, or are they legacy?
   - When does V28C support end (if at all)?
   - Implication: Shapes hardware roadmap and supplier strategy.

3. **Future device models**
   - Are there plans for other device models (V70, V100, etc.)?
   - Timeline for multi-device support?
   - Implication: Determines whether to document single-device or multi-vendor strategy.

## Feature Production-Readiness

4. **Guardian AI & WhatsApp status**
   - Is the WhatsApp assistant production-ready, or still in development?
   - Is Claude integration tested against real use cases, or proof-of-concept?
   - What are the cost controls and rate limits?
   - Are there safety guardrails (e.g., no medical diagnosis)?
   - Implication: Determines whether to market these features and how to document supported use cases.

5. **SOS button behavior**
   - Is the SOS button implemented and tested on real devices?
   - Does it trigger a call, SMS, WhatsApp, or push notification?
   - Who receives the SOS alert, and in what order?
   - Implication: Critical for marketing and documentation.

6. **Voice monitoring (MONITOR command)**
   - Is voice monitoring enabled on real devices?
   - What are the privacy and consent implications?
   - Is this a feature, or a developer-only capability?
   - Implication: Legal/privacy decision before documentation.

7. **Remote photo capture**
   - Is this feature implemented or planned?
   - GitHub issue #28 says "no known command syntax"; has the vendor provided one?
   - Implication: Determines whether to document as a capability.

8. **Pedometer and step counting**
   - Are these features fully implemented and tested?
   - Or are they vendor-documented but not yet wired into the app?
   - Implication: Documentation scope and user expectations.

## Business & Commercial

9. **Device pricing**
   - Is Rs 3,000 the final device price, or subject to negotiation with the supplier?
   - Does the price include margin, or does it need 20-30% markup for retailer?
   - Implication: Informs business model documentation.

10. **Subscription tiers**
    - Are there final subscription plans (Basic/Premium/Care)?
    - Is Rs 199/month accurate, or still under review?
    - What features are tied to each tier?
    - Implication: Marketing, billing, and documentation clarity.

11. **Business model**
    - Is this device-sale + recurring subscription, or hardware-as-a-service rental?
    - Is there a first-year bundle discount?
    - Can subscriptions be paused or cancelled?
    - Implication: Shapes all operations and customer documentation.

12. **Geographic scope**
    - Is Guardian Mauritius-only, or expanding to other SADC countries?
    - Are there regional carrier partnerships locked in?
    - Implication: Determines market documentation and localization priorities.

## Product Vision & Launch

13. **Launch timeline**
    - Is Guardian in closed pilot, open beta, or launching to general availability?
    - When is the planned public launch date?
    - What are the launch criteria (e.g., 100 devices tested, 50 families piloting)?
    - Implication: Determines roadmap documentation and feature prioritization.

14. **Target users**
    - Are the primary users elderly people, children, or families?
    - Are schools/transport a V1 use case, or future (V2+)?
    - Are employers (lone-worker safety) in scope?
    - Implication: Shapes product documentation and feature narrative.

15. **V1 scope**
    - What features are required for V1 launch?
    - What is nice-to-have or planned for V2?
    - Are there hard blockers (e.g., SOS button must work)?
    - Implication: Determines what gets documented as "implemented" vs. "planned".

16. **Safety message**
    - What is Guardian's core safety promise to families?
    - Is it "know they are safe" or something else?
    - What accuracy of location is acceptable to market?
    - Implication: Shapes tone and claims in all documentation.

## Operations & Supplier

17. **Supplier qualification timeline**
    - Is the V52 supplier already qualified, or still in evaluation?
    - When is the first bulk order expected?
    - What are the batch sizes (50, 500, 5000 units)?
    - Implication: Determines urgency of supplier documentation and QA procedures.

18. **Device provisioning**
    - How are devices configured before shipment (APN, server address, SIM)?
    - Is this done by the supplier or by Guardian operations?
    - What is the process for bulk IMEI inventory management?
    - Implication: Operational documentation and supplier agreements.

19. **Carrier lock-in**
    - Are devices locked to a single carrier (Emtel, my.t, Chili)?
    - Or can they be activated on multiple carriers?
    - What is the SIM strategy (eSIM, physical SIM, provider bundling)?
    - Implication: Determines support documentation and operational complexity.

20. **Customer onboarding**
    - How do new customers get started (buy online, retail, distribution)?
    - What is the activation workflow (unbox, activate SIM, link in app)?
    - Who provides initial support (retailer, Guardian, community)?
    - Implication: Customer documentation and support procedures.

## Technical Decisions

21. **Firestore schema finality**
    - Is the current Firestore schema (`firestore/SCHEMA.md`) the source of truth?
    - Are there planned changes before launch?
    - What is the data retention policy?
    - Implication: Stability of backend documentation.

22. **Security rule enforcement**
    - Are the Firestore rules in `firestore/rules.example` enforced in production?
    - Are there any overrides or gaps?
    - Implication: Data security documentation.

23. **Notification delivery guarantees**
    - What are the SLAs for push/SMS/WhatsApp delivery?
    - Is retry logic in place?
    - What happens if a service (FCM, Twilio) is down?
    - Implication: Reliability and troubleshooting documentation.

24. **GPS accuracy claims**
    - What accuracy should Guardian claim publicly (±5m? ±50m? "approximate")?
    - How is accuracy affected by urban/rural/indoor environments?
    - Implication: Marketing and legal compliance.

25. **Offline fallback behavior**
    - If a device goes offline, how long is the last-known location shown?
    - Is there a max-age for last-known-location display?
    - Implication: User experience and reliability documentation.

## Documentation & Governance

26. **Documentation authority**
    - Will this `/docs` directory be the source of truth going forward?
    - Who owns keeping documentation in sync with code (developers, tech lead, product)?
    - What is the review process for documentation changes?
    - Implication: Documentation governance and maintenance burden.

27. **Product vs. engineering docs**
    - Should business/product documentation live in `/docs`, or separately (e.g., Notion)?
    - Is there a Pitch deck, PRD, or business plan to reference?
    - Implication: Documentation split and information architecture.

28. **API documentation**
    - Is there a public API (e.g., for partners to query guardian data)?
    - Should API documentation be in `/docs`?
    - Implication: API stability and documentation requirements.

29. **Customer-facing documentation**
    - Is there a separate customer portal or knowledge base?
    - Or does all documentation live in GitHub for now?
    - Implication: Determines what is internal vs. public.

30. **Supplier documentation**
    - Should supplier onboarding documents and vendor agreements live in the repo?
    - Or are they kept external for confidentiality?
    - Implication: Documentation accessibility and information security.

---

## Summary

**Critical for launch-readiness documentation:**
- Items 1-8 (hardware & features)
- Items 13-16 (product vision & scope)
- Items 17-19 (supplier & operations)

**Important for developer/ops clarity:**
- Items 21-25 (technical decisions)

**Nice-to-have for governance:**
- Items 26-30 (documentation process)

**Recommendation:** Answer items 1-8 and 13-19 before finalizing documentation. Items 21-25 can be derived from code in the interim.


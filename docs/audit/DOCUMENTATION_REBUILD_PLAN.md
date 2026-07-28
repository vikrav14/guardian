# Guardian Documentation Rebuild Plan

**Branch:** `docs/guardian-source-of-truth`  
**Audit completed:** 2026-07-29  
**Status:** Ready for Phase 1 (Core Documentation Build)

---

## Proposed `/docs` Structure

```
docs/
├── README.md
│   └── Documentation homepage and navigation hub
│
├── audit/
│   ├── DOCUMENTATION_AUDIT.md          ✓ Done
│   ├── IMPLEMENTATION_INVENTORY.md     ✓ Done
│   ├── OPEN_QUESTIONS.md               ✓ Done
│   ├── OUTDATED_ASSUMPTIONS.md         ✓ Done
│   └── DOCUMENTATION_REBUILD_PLAN.md   ← You are here
│
├── 00-overview/
│   ├── PRODUCT_OVERVIEW.md             (To build)
│   ├── VISION_AND_MISSION.md           (To build)
│   ├── PRODUCT_PRINCIPLES.md           (To build)
│   ├── GLOSSARY.md                     (To build)
│   └── STATUS_AND_SCOPE.md             (To build)
│
├── 01-product/
│   ├── USER_PROBLEMS.md                (To build)
│   ├── TARGET_USERS.md                 (To build)
│   ├── FEATURE_MAP.md                  (To build)
│   ├── USER_JOURNEYS.md                (To build)
│   ├── SAFETY_MODEL.md                 (To build)
│   ├── NOTIFICATION_PHILOSOPHY.md      (To build)
│   └── PRODUCT_LIMITATIONS.md          (To build)
│
├── 02-architecture/
│   ├── SYSTEM_OVERVIEW.md              (Priority 1)
│   ├── DATA_FLOW.md                    (Priority 1)
│   ├── DEVICE_TO_APP_FLOW.md           (Priority 1)
│   ├── SECURITY_MODEL.md               (Priority 1)
│   ├── FAILURE_MODES.md                (Priority 2)
│   ├── ENVIRONMENTS.md                 (Priority 2)
│   └── ARCHITECTURE_DIAGRAMS.md        (Mermaid; Priority 1)
│
├── 03-mobile/
│   ├── MOBILE_OVERVIEW.md              (Priority 1)
│   ├── APP_STRUCTURE.md                (Priority 1)
│   ├── HOME_AND_MISSION_CONTROL.md     (Priority 2)
│   ├── LIVE_MAP.md                     (Priority 2)
│   ├── DEVICE_LINKING.md               (Priority 1)
│   ├── SAFE_ZONES.md                   (Priority 2)
│   ├── CARE_SETTINGS.md                (Priority 1)
│   ├── NOTIFICATIONS.md                (Priority 2)
│   ├── GUARDIAN_AI_EXPERIENCE.md       (Needs owner input)
│   ├── DODO_EXPERIENCE.md              (Priority 2)
│   ├── DESIGN_SYSTEM.md                (Priority 3)
│   ├── ACCESSIBILITY.md                (Priority 3)
│   └── MOBILE_TESTING.md               (Priority 2)
│
├── 04-gateway/
│   ├── GATEWAY_OVERVIEW.md             (Priority 1)
│   ├── TCP_CONNECTION_LIFECYCLE.md     (Priority 1)
│   ├── PACKET_DECODING.md              (Priority 1)
│   ├── LOCATION_PIPELINE.md            (Priority 1)
│   ├── DEVICE_COMMANDS.md              (Priority 1)
│   ├── DOWNLINK_COMMANDS.md            (Priority 1)
│   ├── GPS_QUALITY_AND_SANITY_CHECKS.md (Priority 2)
│   ├── EVENT_PROCESSING.md             (Priority 1)
│   ├── OBSERVABILITY.md                (Priority 3)
│   └── GATEWAY_TESTING.md              (Priority 2)
│
├── 05-data/
│   ├── FIRESTORE_OVERVIEW.md           (Priority 1)
│   ├── COLLECTION_REFERENCE.md         (Priority 1)
│   ├── SECURITY_RULES.md               (Priority 1)
│   ├── INDEXES.md                      (Priority 2)
│   ├── DATA_OWNERSHIP.md               (Priority 1)
│   ├── RETENTION_AND_HISTORY.md        (Priority 2)
│   └── MIGRATIONS.md                   (Priority 3)
│
├── 06-hardware/
│   ├── HARDWARE_OVERVIEW.md            (Priority 1)
│   ├── V52.md                          (Priority 1; owner decision: primary device)
│   ├── V28C_LEGACY.md                  (Archive from current docs)
│   ├── DEVICE_CAPABILITY_MATRIX.md     (Priority 1)
│   ├── SIM_AND_CARRIER_SETUP.md        (Priority 2; needs owner decision)
│   ├── DEVICE_PROVISIONING.md          (Priority 2; operational)
│   ├── GPS_BEHAVIOR.md                 (Priority 1)
│   ├── BATTERY_AND_REPORTING_INTERVALS.md (Priority 1)
│   ├── FALL_DETECTION.md               (Priority 1)
│   ├── SOS_AND_CALLING.md              (Priority 1; verify behavior)
│   ├── MEDICATION_REMINDERS.md         (Priority 1)
│   ├── FIRMWARE_AND_PROTOCOL.md        (Priority 2)
│   └── KNOWN_DEVICE_LIMITATIONS.md     (Priority 2)
│
├── 07-ai-and-messaging/
│   ├── GUARDIAN_AI_OVERVIEW.md         (Needs owner confirmation: production-ready?)
│   ├── CLAUDE_INTEGRATION.md           (Needs owner confirmation)
│   ├── WHATSAPP_INTEGRATION.md         (Needs owner confirmation: production-ready?)
│   ├── ASSISTANT_REQUEST_FLOW.md       (Needs owner confirmation)
│   ├── AI_SAFETY_AND_BOUNDARIES.md     (Needs owner confirmation)
│   ├── ALERT_EXPLANATIONS.md           (Needs owner confirmation)
│   ├── MEMORY_AND_CONTEXT.md           (Needs owner confirmation)
│   ├── PROMPTS_AND_GUARDRAILS.md       (Needs owner confirmation)
│   └── AI_ROADMAP.md                   (Needs owner confirmation)
│
├── 08-notifications/
│   ├── NOTIFICATION_ARCHITECTURE.md    (Priority 1)
│   ├── EVENT_CATALOG.md                (Priority 1)
│   ├── PUSH_NOTIFICATIONS.md           (Priority 1)
│   ├── WHATSAPP_NOTIFICATIONS.md       (Depends on #7)
│   ├── SOS_ESCALATION.md               (Priority 1; verify flow)
│   ├── BATTERY_ALERTS.md               (Priority 2)
│   ├── SAFE_ZONE_ALERTS.md             (Priority 2)
│   ├── DELIVERY_AND_RETRIES.md         (Priority 2)
│   └── QUIET_HOURS_AND_RATE_LIMITS.md  (Priority 3)
│
├── 09-development/
│   ├── GETTING_STARTED.md              (Priority 1)
│   ├── REPOSITORY_STRUCTURE.md         (Priority 1)
│   ├── LOCAL_DEVELOPMENT.md            (Priority 1)
│   ├── FIREBASE_SETUP.md               (Adapt from existing)
│   ├── FLUTTER_SETUP.md                (Adapt from existing)
│   ├── GATEWAY_SETUP.md                (Priority 1)
│   ├── ENVIRONMENT_VARIABLES.md        (Priority 1)
│   ├── TESTING_GUIDE.md                (Priority 2)
│   ├── DEBUGGING_GUIDE.md              (Priority 3)
│   ├── BRANCHING_AND_PULL_REQUESTS.md  (Priority 2)
│   ├── CODING_STANDARDS.md             (Priority 3)
│   └── CONTRIBUTING.md                 (Priority 3)
│
├── 10-deployment/
│   ├── DEPLOYMENT_OVERVIEW.md          (Priority 2)
│   ├── GATEWAY_DEPLOYMENT.md           (Priority 2)
│   ├── FIREBASE_DEPLOYMENT.md          (Priority 2)
│   ├── MOBILE_BUILDS.md                (Priority 3)
│   ├── WEB_DEPLOYMENT.md               (Priority 3)
│   ├── RELEASE_CHECKLIST.md            (Priority 2)
│   ├── ROLLBACK.md                     (Priority 3)
│   ├── MONITORING.md                   (Priority 3)
│   └── INCIDENT_RESPONSE.md            (Priority 3)
│
├── 11-qa/
│   ├── QA_STRATEGY.md                  (Priority 2)
│   ├── DEVICE_ACCEPTANCE_TESTS.md      (Priority 2)
│   ├── LOCATION_TESTING.md             (Priority 2)
│   ├── SOS_TESTING.md                  (Priority 1; verify flow)
│   ├── FALL_DETECTION_TESTING.md       (Priority 2)
│   ├── BATTERY_TESTING.md              (Priority 2)
│   ├── SAFE_ZONE_TESTING.md            (Priority 2)
│   ├── MOBILE_REGRESSION.md            (Priority 3)
│   ├── GATEWAY_REGRESSION.md           (Priority 3)
│   ├── FIELD_PILOT_PLAN.md             (Priority 2; operational)
│   └── DEFECT_SEVERITY.md              (Priority 3)
│
├── 12-operations/
│   ├── OPERATIONS_OVERVIEW.md          (Priority 2)
│   ├── SUPPLIER_ONBOARDING.md          (Priority 1; launch-blocking)
│   ├── INCOMING_BATCH_QA.md            (Priority 2)
│   ├── DEVICE_REGISTRATION.md          (Priority 2)
│   ├── CUSTOMER_ONBOARDING.md          (Priority 2; needs owner decision)
│   ├── INVENTORY.md                    (Priority 2)
│   ├── PACKAGING.md                    (Priority 3)
│   ├── WARRANTY_AND_RMA.md             (Priority 2)
│   ├── CUSTOMER_SUPPORT.md             (Priority 2)
│   ├── LOST_OR_STOLEN_DEVICE.md        (Priority 3)
│   └── DATA_AND_ACCOUNT_CLOSURE.md     (Priority 2; compliance)
│
├── 13-business/
│   ├── BUSINESS_MODEL.md               (Needs owner decision)
│   ├── PRICING_PRINCIPLES.md           (Needs owner decision)
│   ├── SUBSCRIPTION_PLANS.md           (Needs owner decision)
│   ├── UNIT_ECONOMICS_TEMPLATE.md      (Needs owner decision)
│   ├── MAURITIUS_LAUNCH.md             (Needs owner decision)
│   ├── SALES_CHANNELS.md               (Needs owner decision)
│   ├── SCHOOLS_AND_TRANSPORT.md        (Needs owner decision)
│   ├── ELDERLY_CARE_PARTNERS.md        (Needs owner decision)
│   ├── B2B_OPPORTUNITIES.md            (Needs owner decision)
│   └── BUSINESS_ASSUMPTIONS.md         (Needs owner decision)
│
├── 14-roadmap/
│   ├── MASTER_ROADMAP.md               (Needs owner decision; launch-blocking)
│   ├── LAUNCH_READINESS.md             (Needs owner decision; launch-blocking)
│   ├── V1_SCOPE.md                     (Needs owner decision)
│   ├── POST_LAUNCH.md                  (Needs owner decision)
│   ├── HARDWARE_ROADMAP.md             (Needs owner decision)
│   ├── MOBILE_ROADMAP.md               (Needs owner decision)
│   ├── AI_ROADMAP.md                   (Needs owner decision)
│   └── DECISION_GATES.md               (Needs owner decision)
│
├── 15-decisions/
│   ├── README.md                       (Priority 3)
│   └── ADR-0001-documentation-source-of-truth.md (Priority 3)
│
└── archive/
    └── README.md
```

---

## Phase 1: Core Documentation (First PR)

**What:** Foundational documentation for developers, operators, and product teams.  
**Goal:** Ship a complete, verified documentation base that can be built upon.  
**Owner input required:** Yes (see list below)

### Files to Create/Update in Phase 1

**PRIORITY 1 — Ship with the first PR:**

Root level:
- [ ] New `docs/README.md` (navigation hub)
- [ ] Rewritten `README.md` (root; accurate overview)
- [ ] Rewritten `CONTEXT.md` (orientation for AI assistants)

Architecture (3 files):
- [ ] `02-architecture/SYSTEM_OVERVIEW.md` (mermaid diagram)
- [ ] `02-architecture/DATA_FLOW.md` (mermaid diagram)
- [ ] `02-architecture/DEVICE_TO_APP_FLOW.md` (with sequences)
- [ ] `02-architecture/SECURITY_MODEL.md`

Mobile (3 files):
- [ ] `03-mobile/MOBILE_OVERVIEW.md`
- [ ] `03-mobile/APP_STRUCTURE.md`
- [ ] `03-mobile/DEVICE_LINKING.md` (4-step flow, Dodo states)
- [ ] `03-mobile/CARE_SETTINGS.md`

Gateway (4 files):
- [ ] `04-gateway/GATEWAY_OVERVIEW.md`
- [ ] `04-gateway/TCP_CONNECTION_LIFECYCLE.md`
- [ ] `04-gateway/PACKET_DECODING.md`
- [ ] `04-gateway/LOCATION_PIPELINE.md`
- [ ] `04-gateway/DEVICE_COMMANDS.md`
- [ ] `04-gateway/DOWNLINK_COMMANDS.md`
- [ ] `04-gateway/EVENT_PROCESSING.md`

Firestore (3 files):
- [ ] `05-data/FIRESTORE_OVERVIEW.md`
- [ ] `05-data/COLLECTION_REFERENCE.md` (from SCHEMA.md)
- [ ] `05-data/SECURITY_RULES.md`
- [ ] `05-data/DATA_OWNERSHIP.md`

Hardware (4 files):
- [ ] `06-hardware/HARDWARE_OVERVIEW.md`
- [ ] `06-hardware/V52.md` (primary device)
- [ ] `06-hardware/DEVICE_CAPABILITY_MATRIX.md` (table from inventory)
- [ ] `06-hardware/GPS_BEHAVIOR.md`
- [ ] `06-hardware/BATTERY_AND_REPORTING_INTERVALS.md`
- [ ] `06-hardware/FALL_DETECTION.md`
- [ ] `06-hardware/SOS_AND_CALLING.md`
- [ ] `06-hardware/MEDICATION_REMINDERS.md`

Notifications (2 files):
- [ ] `08-notifications/NOTIFICATION_ARCHITECTURE.md`
- [ ] `08-notifications/EVENT_CATALOG.md`
- [ ] `08-notifications/PUSH_NOTIFICATIONS.md`

Development (4 files):
- [ ] `09-development/GETTING_STARTED.md`
- [ ] `09-development/REPOSITORY_STRUCTURE.md`
- [ ] `09-development/LOCAL_DEVELOPMENT.md`
- [ ] `09-development/GATEWAY_SETUP.md`
- [ ] `09-development/ENVIRONMENT_VARIABLES.md`

Operations (1 file):
- [ ] `12-operations/SUPPLIER_ONBOARDING.md` (8-week plan, needs owner input)

Roadmap (1 file):
- [ ] `14-roadmap/MASTER_ROADMAP.md` (needs owner input)

---

## Phase 2: Product & Experience (After Phase 1, conditional on owner input)

**What:** Product-facing documentation for users, product managers, and business stakeholders.  
**Depends on:** Owner confirmation of vision, scope, and launch timeline.

Files in Phase 2:
- `00-overview/` (5 files)
- `01-product/` (7 files)
- `13-business/` (10 files, all need owner input)

---

## Phase 3: Testing, Support & Governance (After Phase 1)

**What:** QA procedures, customer-facing docs, and documentation governance.  
**Depends on:** Launch timeline and support model finalization.

Files in Phase 3:
- `11-qa/` (11 files)
- `10-deployment/` (9 files)
- `07-ai-and-messaging/` (9 files, need owner confirmation)
- `15-decisions/` (ADRs)

---

## Owner Decisions Required Before Phase 1 Completes

✓ = Can be documented from code without owner input  
✗ = Requires owner confirmation

| Item | Phase 1 | Approval needed |
|------|---------|---|
| V52 as primary hardware | ✓ Yes | ✗ Confirm V52 primary, V28C deprecated? |
| V28C support status | ✓ Yes | ✗ Archive or maintain? |
| Fall detection | ✓ Yes | ✗ Confirm device behavior tested |
| SOS button flow | ✓ Yes | ✗ Verify end-to-end (app→SMS/push/WhatsApp) |
| Medication reminders | ✓ Yes | ✗ Confirm device supports display/voice |
| Location reporting interval (UPLOAD) | ✓ Yes | ✓ Already tested and verified |
| Guardian AI readiness | ✗ No | ✗ Is it production or pilot? |
| WhatsApp readiness | ✗ No | ✗ Is it production or pilot? |
| Supplier onboarding plan | Partial | ✓ Will build 8-week template; needs timelines |
| Master roadmap | ✗ No | ✗ Launch date, V1 scope, phases? |
| Device pricing | ✗ No | ✗ Rs 3,000 finalized? |
| Subscription tiers | ✗ No | ✗ Plans finalized? |

---

## First Pull Request: "docs: build Guardian documentation source of truth"

### PR Title
```
docs: build Guardian documentation source of truth
```

### PR Description

**Summary:**
Complete audit and rebuild of Guardian documentation based on current code, tests, and live behavior. Replaces severely outdated README and CONTEXT.md with accurate, verified documentation. First PR focuses on foundational architecture, mobile app, gateway, Firestore, hardware, and operations documentation.

**What changed:**
- Audit files: 4 new files documenting every component's current status, implementation status, and gaps
- Documentation structure: 15 sections, 150+ planned files
- First batch: 50+ files covering core platform (architecture, mobile, gateway, Firestore, hardware, operations)
- Deprecated/archived: V28C-specific docs marked as legacy; README/CONTEXT completely rewritten

**What's verified (from code + tests):**
- ✓ Flutter is fully implemented (not "next")
- ✓ V52 is primary hardware (V28C appears legacy)
- ✓ Guardian AI and WhatsApp are implemented in code (production-readiness TBD)
- ✓ Care Settings fully implemented (fall detection, medication, location interval)
- ✓ Multiple linked pendants supported
- ✓ Safe zones implemented and working
- ✓ Dodo character integrated with connection states
- ✓ Gateway protocol handles V52 and V46/V48/V52 variants
- ✓ UPLOAD command for location reporting interval works and verified on real hardware
- ✓ Firestore schema and security rules current

**What's not yet verified (marked TBD):**
- SOS button end-to-end flow (protocol exists; UI verification pending)
- Guardian AI production-readiness
- WhatsApp production-readiness
- Device fall/medication-reminder UI display
- Remote photo capture and voice monitoring (no implementation found)

**What's pending owner input:**
- V28C support status (archive or maintain?)
- Device pricing and subscription tiers
- Launch timeline and V1 scope
- Guardian AI and WhatsApp go/no-go decision
- Supplier and operations details
- Business model finalization

**How to read this PR:**
1. Start with `docs/audit/DOCUMENTATION_AUDIT.md` (big-picture status)
2. Check `docs/audit/IMPLEMENTATION_INVENTORY.md` (what's really built)
3. Review `docs/audit/OPEN_QUESTIONS.md` (30 owner-decision items)
4. Check `docs/audit/OUTDATED_ASSUMPTIONS.md` (what changed)
5. Read new documentation starting with `docs/README.md`

**Merge strategy:**
Merge when audit is approved. Use audit files as foundation for Phase 2 and 3 documentation work.

---

## Next Steps After Phase 1 PR Merges

1. **Owner review** (1-2 weeks)
   - Verify audit findings
   - Answer OPEN_QUESTIONS.md (priority: 1-8, 13-19)
   - Confirm V28C status, business model, launch timeline

2. **Phase 2: Product & business docs** (2-3 weeks)
   - Build feature map, roadmap, business model docs
   - Depends on owner answers to questions 13-16, 20, 26-27

3. **Phase 3: Support & QA** (2-3 weeks)
   - QA procedures, deployment, AI/messaging docs
   - Depends on launch timeline and support model

4. **Wiki migration & cleanup** (1 week)
   - Export useful content from GitHub Wiki
   - Replace with archive notice
   - Link to new `/docs` as source of truth

---

## Documentation Standards Going Forward

Every new feature or change should include:

✓ **Code change** (in PR)  
✓ **Test coverage** (in PR)  
✓ **Documentation update** (in PR, under `/docs`)  

Documentation checklist before merge:
- [ ] Verified from code (not assumed)
- [ ] Linked to relevant source code paths
- [ ] Test coverage mentioned where applicable
- [ ] Limitations and failure modes documented
- [ ] Owner-decision items flagged clearly
- [ ] No secrets or sensitive data exposed


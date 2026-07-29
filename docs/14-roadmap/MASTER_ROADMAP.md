# Guardian Master Roadmap

**Last updated:** 2026-07-29

Strategic roadmap for Guardian's launch and growth phases.

## Vision

Guardian is a Mauritius-first family safety platform combining GPS tracking, AI assistance, and family-centric design to deliver meaningful reassurance.

**North Star:** Know they are safe.

---

## Launch Phases

### Phase 0: Pre-Launch Pilot (Current)

**Status:** In progress  
**Duration:** ~8 weeks (Sep–Oct 2026)  
**Focus:** Qualify supplier, verify features, build confidence

**Key Activities:**
- Supplier onboarding (8-week plan in `12-operations/SUPPLIER_ONBOARDING.md`)
- Field pilot with 50 devices and 20–30 families
- Complete documentation (you are here)
- Final security & reliability testing

**Success Criteria:**
- ✓ 100+ devices tested with >95% uptime
- ✓ All features verified with real users
- ✓ Zero critical bugs in field
- ✓ Supplier ready for bulk manufacturing

**Deliverables:**
- Phase 1 documentation (complete)
- Supplier qualification report
- Launch readiness checklist
- Support procedures

**Go/No-Go Gate:** Field pilot successful? All systems production-ready? → Proceed to Closed Pilot

---

### Phase 1: Closed Pilot Launch (Nov 2026)

**Status:** Planned  
**Duration:** 4–6 weeks  
**Target Users:** Friends & family, beta community, select retailers

**Features:**
- ✓ Live map + device linking
- ✓ Safe zones + geofencing
- ✓ Care settings (fall detection, medication reminders, location interval)
- ✓ Family sharing (multiple caregivers)
- ✓ Push + SMS/WhatsApp alerts
- ? Guardian AI assistant (status TBD)
- ? Voice monitoring (unverified, may omit)

**Scale Target:**
- 500–1,000 active devices
- 200–500 caregiver accounts

**Success Criteria:**
- >90% monthly active users
- <1% critical bug report rate
- <1 hour median support response time
- Positive user feedback (NPS >30)

**Work Before Launch:**
- [ ] Finalize pricing & subscription tiers
- [ ] Set up payment processing
- [ ] Complete customer support team training
- [ ] Create marketing materials & landing page
- [ ] Prepare carrier agreements (SIM provisioning)

---

### Phase 2: Open Beta (Dec 2026 – Jan 2027)

**Status:** Planned  
**Duration:** 4–8 weeks  
**Target Users:** Public signup (via website)

**Features:**
All Phase 1 features, plus:
- [ ] Improved onboarding flow (guided setup)
- [ ] Device settings UI improvements
- [ ] WhatsApp assistant production-ready (if Phase 1 successful)
- [ ] Location history export / data download

**Scale Target:**
- 5,000+ devices
- 2,000+ accounts

**Success Criteria:**
- Sustained >85% DAU/MAU ratio
- <0.5% churn rate
- >50% NPS
- Zero security incidents
- Positive media coverage

**Work Before Launch:**
- [ ] Scale infrastructure (database, server capacity)
- [ ] Implement monitoring & alerting
- [ ] Set up customer analytics (usage, retention)
- [ ] Prepare public comms (press release, blog posts)

---

### Phase 3: General Availability (Feb 2027+)

**Status:** Long-term  
**Focus:** Growth, retention, expansion

**Features:**
All prior features, plus:
- [ ] Multiple device types (if adding new models)
- [ ] Advanced analytics (location history visualization, trends)
- [ ] Integration with other apps (calendar, reminders, emergency services)
- [ ] Localization (multiple languages, regional carriers)

**Scale Target:**
- 50,000+ devices
- 20,000+ accounts

**Business Goals:**
- Profitability (LTV > CAC)
- Regional expansion (SADC countries)
- Enterprise partnerships (schools, senior care facilities)

---

## Feature Roadmap by Priority

### MVP (Must Have for Launch)

| Feature | Status | Phase | Notes |
|---------|--------|-------|-------|
| Live map + marker | ✓ Complete | 0 | Core feature |
| Device linking | ✓ Complete | 0 | 4-step Dodo sequence |
| Location tracking | ✓ Complete | 0 | Real-time via Firestore |
| Safe zones | ✓ Complete | 0 | Enter/exit alerts |
| Push notifications | ✓ Complete | 0 | FCM integration |
| SMS alerts | ✓ Complete | 0 | Twilio integration |
| Care settings | ✓ Complete | 0 | Fall, medication, interval |
| Family sharing | ✓ Complete | 0 | Multiple caregivers |
| Device status | ✓ Complete | 0 | Online/offline/battery |
| Last-known-location | ✓ Complete | 0 | When device offline |
| Device commands | ✓ Complete | 0 | UPLOAD, FALLDOWN, etc. |
| Firestore schema | ✓ Complete | 0 | Production-ready |
| Security rules | ✓ Complete | 0 | `linkedTo(imei)` pattern |

**All MVP features complete and tested.** ✓

### Phase 1 (Should Have for Closed Pilot)

| Feature | Status | Phase | Notes |
|---------|--------|-------|-------|
| WhatsApp notifications | ⏳ Built, TBD production-ready | 1–2 | Code exists; readiness TBD |
| Guardian AI assistant | ⏳ Built, TBD production-ready | 1–2 | Claude integration; readiness TBD |
| SOS button verification | ⏳ Device has it, not end-to-end verified | 1 | Need user test |
| Device settings UI | ✓ Mostly complete | 1 | May need polish |
| Alerts history | ✓ Complete | 0 | Alerts tab in app |

### Phase 2+ (Nice to Have)

| Feature | Status | Phase | Notes |
|---------|--------|-------|-------|
| Improved onboarding | 📋 Planned | 2 | Guided setup flow |
| Location history export | 📋 Planned | 2 | Download CSV/PDF |
| Advanced analytics | 📋 Planned | 3 | Dashboards, trends |
| Voice monitoring | ❓ Unverified, privacy concerns | TBD | Unverified; needs decision |
| Remote photo capture | ❌ No vendor support | TBD | No command syntax known |
| Pedometer/steps | ❓ Unverified | TBD | Device capability unclear |
| Multiple device models | 📋 Planned | 3 | Add V46, V48, future devices |
| Localization | 📋 Planned | 2–3 | French, Creole, etc. |
| Calendar integration | 📋 Planned | 3 | Sync with device reminders |

---

## Critical Blockers & Dependencies

### Must Resolve Before Closed Pilot (Phase 1)

1. **Device pricing finalized** (Rs 3,000? With margin?)
2. **Subscription tiers finalized** (Free/Premium/Care? Pricing?)
3. **SOS button end-to-end verified** (Tested with real device + emergency contact)
4. **Supplier qualification complete** (8-week onboarding plan)
5. **Carrier agreements signed** (Bulk SIM activation, preferred rates)
6. **WhatsApp production-readiness confirmed** (Cost, rate limits, guardrails)
7. **Guardian AI production-readiness confirmed** (Cost, safety, accuracy)
8. **Payment processing ready** (Stripe? PayGate? Local method?)
9. **Customer support process defined** (Email? Chat? WhatsApp?)
10. **Marketing materials ready** (Website, landing page, social media)

### Must Resolve Before Open Beta (Phase 2)

11. **Scale testing complete** (5,000+ concurrent devices supported?)
12. **Data retention policy finalized** (Delete old locations after 90 days?)
13. **Privacy policy & ToS finalized** (Legal review)
14. **Security audit complete** (Penetration testing, code review)
15. **Monitoring & alerting live** (Can ops team spot issues?)

### Must Resolve Before GA (Phase 3)

16. **Regional expansion plan** (Which SADC countries next?)
17. **Enterprise partnerships** (Schools? Senior care? Lone worker?)
18. **Localization framework** (Multi-language, multi-region)

---

## Launch Checklist

### Before Closed Pilot

**Product & Engineering**
- [ ] All MVP features complete & tested
- [ ] Documentation complete (Phase 1 ✓)
- [ ] 50+ devices field-tested >95% uptime
- [ ] Zero critical bugs in field
- [ ] Supplier ready for bulk order
- [ ] SOS button end-to-end verified
- [ ] WhatsApp production status confirmed
- [ ] Guardian AI production status confirmed

**Operations**
- [ ] Support team trained
- [ ] Provisioning procedure documented
- [ ] Inventory system live
- [ ] Carrier agreements signed
- [ ] Payment processing ready

**Legal & Business**
- [ ] Pricing finalized (device + subscription)
- [ ] Subscription tiers defined
- [ ] Privacy policy drafted
- [ ] ToS drafted
- [ ] Security audit passed

**Marketing**
- [ ] Website live
- [ ] Landing page ready
- [ ] Social media accounts set up
- [ ] Press release drafted

### Before Open Beta

**Scale & Operations**
- [ ] Load testing passed (5,000+ devices)
- [ ] Database optimized & indexed
- [ ] CDN configured for assets
- [ ] Monitoring & alerting live
- [ ] Disaster recovery tested

**Legal & Compliance**
- [ ] Privacy policy finalized
- [ ] ToS finalized & reviewed
- [ ] GDPR compliance (if EU users)
- [ ] Mauritius data residency verified
- [ ] Payment compliance (PCI DSS)

**Marketing & Growth**
- [ ] Closed pilot results published
- [ ] Beta signup page ready
- [ ] Email campaigns ready
- [ ] Influencer / media outreach

### Before GA

**Business Model**
- [ ] Profitable unit economics (LTV > CAC)
- [ ] Retention metrics healthy (>70% MAU retention)
- [ ] Regional expansion plan approved
- [ ] Enterprise sales pipeline established

---

## Key Metrics & Success Criteria

### Adoption

| Metric | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|---------|
| **Active Devices** | 100 | 500–1K | 5K+ | 50K+ |
| **Accounts** | 50 | 200–500 | 2K+ | 20K+ |
| **DAU/MAU Ratio** | >80% | >90% | >85% | >80% |

### Reliability

| Metric | Target |
|--------|--------|
| **Device Uptime** | >95% monthly |
| **API Latency** | <200ms median |
| **Push Delivery Rate** | >98% |
| **Geofence Accuracy** | >99% enter/exit detection |

### Retention

| Metric | Target |
|--------|--------|
| **Monthly Churn** | <2% (Phase 0–1), <1% (Phase 2+) |
| **NPS** | >30 (Phase 1), >50 (Phase 2+) |
| **Support Resolution Time** | <24 hours |

### Revenue

| Metric | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|
| **Hardware Revenue (MRU)** | 500K | 2M | 10M |
| **Subscription Revenue (MRU)** | 150K | 750K | 3M |
| **Profitability** | Break-even target | Positive | Positive |

---

## Unknowns & Owner Decisions Needed

See [`docs/audit/OPEN_QUESTIONS.md`](../audit/OPEN_QUESTIONS.md) for 30 explicit questions.

**Critical decisions blocking roadmap:**
1. Device pricing & business model (sale + subscription vs. rental?)
2. WhatsApp assistant production-readiness
3. Guardian AI production-readiness
4. V28C deprecation timeline
5. Regional expansion priorities
6. Enterprise market focus vs. consumer-only

---

## Contingencies

### If Supplier Fails (Week 8)
- Identify alternative device manufacturer
- Negotiate expedited onboarding
- Delay launch by 4–6 weeks

### If Field Pilot Struggles (Week 6)
- Root-cause analysis with supplier
- Fix firmware issue or design flaw
- Re-pilot with 50 new devices
- Consider device alternative

### If WhatsApp/AI Not Production-Ready
- Launch Phase 1 without these features
- Market as "coming soon"
- Add in Phase 2

### If Profitability Target Missed
- Increase subscription price (if market allows)
- Reduce COGS via supplier negotiation
- Focus on high-value segments (elderly care, schools)
- Delay expansion until unit economics improve

---

## Communication

**Weekly:** Engineering standup  
**Bi-weekly:** Product + ops sync  
**Monthly:** Stakeholder update (progress, blockers, roadmap)  
**Quarterly:** Strategic review (adjust roadmap based on market feedback)

---

## See Also

- [Supplier Onboarding](../12-operations/SUPPLIER_ONBOARDING.md) — 8-week plan
- [Open Questions](../audit/OPEN_QUESTIONS.md) — 30 decisions needed
- [Implementation Inventory](../audit/IMPLEMENTATION_INVENTORY.md) — What's built
- [Master README](../../README.md) — Overview

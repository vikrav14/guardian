# Supplier Onboarding: 8-Week Plan

**Last updated:** 2026-07-29

Plan for qualifying the V52 device supplier and onboarding for bulk production.

## Overview

This 8-week plan takes the supplier from initial engagement to bulk device provisioning.

**Primary goals:**
1. Verify device firmware meets specifications
2. Test full end-to-end flow on production devices
3. Establish provisioning workflow (APN, server, SIM)
4. Prepare for bulk manufacturing and shipping

**Success criteria:**
- Device can send location via GT06 protocol
- Device responds to all critical commands (UPLOAD, FALLDOWN, TAKEPILLS)
- 100+ devices tested in field with real caregivers
- Provisioning procedure documented
- Supplier can deliver first bulk order on schedule

---

## Timeline

### Week 1: Engagement & Device Samples

**Objective:** Get sample devices, confirm protocol compliance

**Actions:**
- [ ] Send supplier: Device specifications, protocol requirements, test plan
- [ ] Receive: 5–10 sample V52 devices
- [ ] Receive: Device firmware version info
- [ ] Receive: SIM card provisioning guide

**Deliverables:**
- Device samples in hand
- Supplier technical contact identified
- Firmware version documented

**Go/No-Go Decision:** Can devices connect via TCP? (Basic connectivity test)

---

### Week 2: Protocol Verification

**Objective:** Confirm devices speak GT06 protocol correctly

**Actions:**
- [ ] Set gateway to log all TCP packets (raw hex dumps)
- [ ] Provision sample devices with:
  - APN: Your carrier
  - Server IP/port: Gateway address
  - Tracking interval: 30 seconds
- [ ] Test packets received:
  - LK (heartbeat) ✓
  - UD (location) ✓
  - AL (alarm) ✓ (if tested)
  - CONFIG (read-back) ✓
- [ ] Compare to GT06 spec in `docs/06-hardware/PROTOCOL_REFERENCE.md`
- [ ] Document any deviations or firmware quirks

**Deliverables:**
- Protocol verification report (all packet types confirmed)
- Firmware version vs. expected behavior mapping
- List of any protocol surprises

**Go/No-Go Decision:** Do all critical packets parse correctly?

---

### Week 3: Command Testing

**Objective:** Verify device responds to all commands

**Actions:**
- [ ] Test command: `UPLOAD,300` (set 5-min reporting interval)
  - Verify device echoes command in next LK heartbeat
  - Monitor that location intervals decrease to ~5 minutes
- [ ] Test command: `FALLDOWN,1,3` (enable fall detection, sensitivity 3)
  - Verify device acknowledges
  - Note: Can't fully test fall without dropping device
- [ ] Test command: `TAKEPILLS,1400,daily` (pill reminder at 2pm daily)
  - Verify device acknowledges
  - Check if on-device display/voice works (manual check)
- [ ] Test command: `CR#` (position request)
  - Verify device sends location within 30s
- [ ] Test command: `FIND#` (ring to locate)
  - Verify on-device buzzer/sound works (manual check)

**Deliverables:**
- Command compliance matrix (all commands work?)
- Any command failures documented with device response
- Supplier firmware updates (if needed)

**Go/No-Go Decision:** Can device execute all required commands?

---

### Week 4: GPS & Geofencing

**Objective:** Test location accuracy and geofence logic

**Actions:**
- [ ] Drive device route: 5–10 known GPS waypoints
- [ ] Log locations from each waypoint (outdoor, GPS-only)
- [ ] Measure accuracy vs. expected coordinates (~5–15m)
- [ ] Create safe zones and test:
  - Zone entry detection
  - Zone exit detection
  - False positives (zone boundary edge cases)
- [ ] Test WiFi fallback (indoor location):
  - Turn off GPS, verify WiFi/LBS fallback works
  - Check accuracy is marked as approximate (gpsValid=false)
- [ ] Document Mauritius hemisphere correction (already implemented in gateway)

**Deliverables:**
- GPS accuracy report (min/max/avg error)
- Geofence test results (enter/exit detection)
- Fallback accuracy (WiFi vs. GPS)

**Go/No-Go Decision:** GPS accuracy acceptable? Geofence logic sound?

---

### Week 5: Battery & Reliability

**Objective:** Test battery life and uptime

**Actions:**
- [ ] Charge device fully
- [ ] Log battery % at fixed intervals (hourly) for 24+ hours
- [ ] Calculate hours until battery critical (<20%)
- [ ] Document expected battery life at different reporting intervals:
  - 30s interval: X hours
  - 5min interval: Y hours
  - 60min interval: Z hours
- [ ] Test device reliability:
  - Uptime over 48 hours (should maintain TCP connection)
  - Offline resilience (device buffers locations during no-signal)
  - Reconnection behavior (resends buffered data)
- [ ] Test device behavior at low battery:
  - Does it send low-battery alert?
  - Does it gracefully degrade functionality?

**Deliverables:**
- Battery life report by reporting interval
- Uptime/reliability metrics
- Low-battery behavior documented

**Go/No-Go Decision:** Battery life meets expectations? No unexpected failures?

---

### Week 6: Field Pilot (50 Devices)

**Objective:** Real-world testing with actual caregivers

**Actions:**
- [ ] Provision 50 devices with:
  - Bulk IMEI inventory
  - Pre-configured APN + server
  - SIM cards
- [ ] Recruit 20–30 pilot families:
  - Mix of elderly + children (different use cases)
  - Urban + rural locations (signal variety)
  - Different activity levels
- [ ] Deploy devices to families
- [ ] Monitor for 2 weeks:
  - Geofence alerts (enter/exit working?)
  - Location updates (stale data?)
  - SOS button usage (any presses?)
  - Device failures (any dropped offline?)
  - Battery drainage (realistic expectations?)
- [ ] Collect user feedback:
  - Is wearability comfortable?
  - Is Dodo UI understandable?
  - Are alerts going to right recipients?
  - Any functionality gaps?

**Deliverables:**
- Field test report (uptime %, alert reliability %)
- User feedback summary
- Failure logs (any devices died? Why?)

**Go/No-Go Decision:** >95% uptime? User satisfaction acceptable?

---

### Week 7: Provisioning & Scaling

**Objective:** Finalize bulk provisioning workflow

**Actions:**
- [ ] Finalize device provisioning procedure with supplier:
  - Who provisions APN? (Supplier or Guardian?)
  - Who provisions server IP? (Supplier or Guardian?)
  - Who activates SIM cards? (Guardian or carrier?)
  - What's the turnaround time per device? (minutes? hours?)
- [ ] Create provisioning checklist:
  - Device configuration steps
  - QA testing per device
  - Packing / shipping procedures
- [ ] Test bulk provisioning on 100 devices:
  - Provision 100 devices in 1–2 days
  - Verify >99% successful activation
  - Document time per device
- [ ] Establish inventory tracking:
  - Bulk IMEI list management
  - SIM card allocation
  - Device ship-to locations

**Deliverables:**
- Provisioning procedure documentation
- QA checklist per device
- Bulk provisioning timeline (X devices/day)
- Inventory system (spreadsheet or database)

**Go/No-Go Decision:** Can supplier provision 1000s of devices efficiently?

---

### Week 8: Launch Readiness

**Objective:** Final verification and launch preparation

**Actions:**
- [ ] Security audit:
  - Device can't impersonate another device (IMEI validation)
  - Device can't access other users' data (Firestore rules enforced)
  - No unencrypted credentials in device firmware
- [ ] Production deployment:
  - Deploy gateway to production server (not localhost)
  - Configure DNS/certificate for real domain
  - Set up monitoring/alerting
  - Test failover/backup procedures
- [ ] Launch readiness checklist:
  - [ ] All 50 pilot devices >95% uptime
  - [ ] Zero critical bugs in field
  - [ ] User documentation complete
  - [ ] Support process defined
  - [ ] Supplier can deliver first bulk order
  - [ ] Carrier agreements signed
  - [ ] Payment processing ready
- [ ] Handoff to support team:
  - Train support team on device issues
  - Document common troubleshooting
  - Set up monitoring dashboards

**Deliverables:**
- Security audit report
- Production deployment checklist
- Launch readiness sign-off
- Support team training complete

**Go/No-Go Decision:** Ready to launch to general availability?

---

## Key Decision Points

| Week | Decision | Success Criteria |
|------|----------|---|
| 1 | Device samples received? | >5 working devices in hand |
| 2 | Protocol compliance? | All packet types parse correctly |
| 3 | Command execution? | 100% command success rate |
| 4 | Location accuracy? | GPS ±5–15m, geofence entry/exit working |
| 5 | Reliability? | >48hr uptime, battery life matches spec |
| 6 | Field pilot success? | >95% uptime, positive user feedback |
| 7 | Provisioning ready? | Can provision 100 devices in 1–2 days |
| 8 | Launch ready? | All criteria met, zero critical bugs |

## Contingency Plans

### If Protocol Issues Found (Week 2)
- Request firmware update from supplier
- Consider alternative device model
- Adjust gateway to work around firmware quirks

### If GPS Accuracy Poor (Week 4)
- Adjust geofence radius (be more forgiving)
- Document limitation ("approx ±50m instead of ±5m")
- Consider WiFi safe-zones for home/work

### If Battery Life Too Short (Week 5)
- Increase default reporting interval (60min instead of 5min)
- Document user expectation: "Recharge every 2–3 days"
- Consider longer battery module (ask supplier)

### If Field Pilot Failure Rate High (Week 6)
- Pause mass production
- Root-cause analysis with supplier
- Fix firmware issue or device design flaw
- Re-pilot with 50 new devices

---

## Success Metrics

By end of Week 8, you should have:

✓ **Device Qualification**
- 100+ devices tested
- >95% uptime in field
- All commands working
- GPS accuracy documented

✓ **Provisioning Process**
- Documented procedure
- >99% successful activation
- Time per device known
- Inventory system in place

✓ **Launch Readiness**
- Security audit passed
- Production gateway live
- Support team trained
- First bulk order ready

✓ **User Confidence**
- Pilot families satisfied
- Zero critical bugs reported
- Marketing material accurate
- Feature claims validated

---

## Next Steps

- Recruit first pilot group (Week 6)
- Set up production server (Week 8)
- Plan go-to-market strategy (parallel to this plan)
- Coordinate with carrier for SIM bulk activation

**Document everything.** Every decision, every test result, every failure becomes institutional knowledge for the next phase.

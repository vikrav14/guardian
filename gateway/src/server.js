const net = require('net');

const config = require('./config');

const { logNgrokHint } = require('./ngrok-hint');
const { maybeAnnounceConnecting } = require('./connection-handshake');
const { buildSessionPersistPatch, shouldForceSessionPersist, buildPresenceTouchPatch, SESSION_LIVE_PACKETS } = require('./connection-live');
const { scheduleDeviceOffline, cancelPendingOffline } = require('./device-offline');
const { correctFleetHemisphere } = require('./fleet-hemisphere');

const { extractFrames, decodeFrame, handlePacket } = require('./protocol/gt06');

const {

  initFirestore,

  getDb,

  getDeviceDocument,

  upsertDevice,

  appendLocation,

  appendSegment,

  appendJourney,

  createAlert,

  refreshDeviceIntelligence,

  startIntelligenceMonitor,

} = require('./firestore');

const { evaluateGeofenceTransitions, getGeofencePresence } = require('./geofence');

const { geolocateFromV } = require('./geolocate/google');
const { buildLocationProvenancePatch } = require('./location-provenance');
const { withFallLocationSnapshot } = require('./fall-location-snapshot');
const { buildSosLocationSnapshot } = require('./sos-location-snapshot');
const {
  extractV52TelemetryValues,
  buildV52TelemetryPatch,
} = require('./v52-telemetry');
const {
  ActivityStepsStore,
  deleteExpiredActivityDays,
} = require('./activity-steps');

const { startHttpServer } = require('./http');

const { startReminderScheduler } = require('./reminder-scheduler');
const { applyAdaptiveReporting, activateSosOverride } = require('./adaptive-reporting');
const { sendContinuousReporting } = require('./downlink');
const { createWellbeingStore } = require('./care-wellbeing');
const { claimSosIncident } = require('./sos-incident-window');
const { observeWifiHomeEvent, startWifiHomeDisplayPilot, getHomeWifiPriority, observeHomeWifiWalk } = require('./wifi-home-runtime');
const { recoverHomeWifiWalk } = require('./home-wifi-walk-recovery');
const { selectHomeWifiTracking } = require('./wifi-home-tracking');
const { observeWifiFencePacket } = require('./wifi-fence-runtime');

const {
  incrementEvent,
  recordWriteGate,
  startMetricsFlusher,
} = require('./ops-metrics');

const {

  registerSession,

  unregisterSession,

  getSession,

  findSocketsForDevice,

  touchSessionActivity,

  noteSessionPacket,

  noteDeviceLocation,

} = require('./sessions');

const {

  onDeviceConnect,

  onDeviceDisconnect,

  seedLastKnownLocation,

  updateLiveState,

  getLiveDeviceState,

  shouldPersist,

  recordPersist,

  recordSkip,

  trackPointForDwell,

  flushDwellIfNeeded,

  trackPointForJourney,

  flushJourneyIfNeeded,

  isJourneyActive,

  noteObservationForJourney,
  noteDiagnosticEventForJourney,

  getWriteGateStats,

  resetWriteGateStats,

  JUMP_SANITY_METERS,

} = require('./live-cache');



initFirestore();

const temperatureTrialQuarantine = require('./temperature-trial-quarantine')
  .createTemperatureTrialQuarantine({ pilotImei: config.wifiHomePilotImei });
const wellbeingStore = config.careWellbeingIngestEnabled === true ? createWellbeingStore({
  db: getDb(),
  enabled: config.careWellbeingIngestEnabled,
  deviceMode: config.careWellbeingDeviceMode,
  customerEnabled: config.careWellbeingCustomerEnabled,
  retentionDays: config.careWellbeingRetentionDays,
  temperaturePilotImei: config.wifiHomePilotImei,
  temperatureTrialQuarantine,
}) : null;
const temperatureCapture = config.temperatureCaptureEnabled === true
  ? require('./temperature-capture').startTemperatureCapture({ config, db: getDb(), enabled: true })
  : null;
const wearCapture = config.wearCaptureEnabled === true
  ? require('./wear-capture').startWearCapture({ enabled: true, pilotImei: config.wifiHomePilotImei })
  : null;
const { createWearEvidence } = require('./wear-evidence');
const wearEvidence = createWearEvidence({ db: getDb(),
  enabled: config.activityStepsIngestEnabled || config.careWellbeingIngestEnabled || config.removalAlertsIngestEnabled,
  deviceMode: config.wearEvidenceDeviceMode, acceptedImeis: config.wearEvidenceAcceptedImeis,
  onError: error => console.warn(`[wear-evidence] persistence failed: ${error.message}`),
});
const wellnessRoutine = config.careWellbeingRequestEnabled || config.wellnessRoutinePilotEnabled
  ? require('./wellness-routine-runtime').startWellnessRoutineRuntime({
    db: getDb(), config, wearEvidence, temperatureTrialQuarantine,
  }) : null;

const activityStepsStore = config.activityStepsIngestEnabled === true ? new ActivityStepsStore(getDb(), {
  enabled: config.activityStepsIngestEnabled,
  customerEnabled: config.activityStepsCustomerEnabled,
  counterMode: config.activityStepsCounterMode,
  timeZone: config.activityStepsTimeZone,
  retentionDays: config.activityStepsRetentionDays,
  writeIntervalMinutes: config.activityStepsWriteMinutes,
  maxStepsPerMinute: config.activityStepsMaxPerMinute,
}) : null;

if (config.activityStepsIngestEnabled && getDb()) {
  const cleanupActivityDays = async () => {
    try {
      const deleted = await deleteExpiredActivityDays(getDb());
      if (deleted > 0) {
        console.log(`[activity] deleted ${deleted} expired daily record(s)`);
      }
    } catch (err) {
      console.warn(`[activity] expiry cleanup failed: ${err.message}`);
    }
  };
  const timer = setInterval(
    cleanupActivityDays,
    config.activityStepsCleanupMinutes * 60_000,
  );
  timer.unref?.();
}

let journeyReliability = null;
if (config.journeyJournalEnabled === true && !config.firestoreDisabled) {
  const { createJourneyReliability } = require('./journey-reliability');
  journeyReliability = createJourneyReliability({ directory: config.journeyJournalDirectory, getDb, appendJourney,
    readHomeEvidence: getHomeWifiPriority,
    closeAtHome: (imei, home) => selectHomeWifiTracking(imei, null, home, new Date()).flushes });
  journeyReliability.journal.acquire();
  process.once('exit', () => journeyReliability.journal.release());
  require('./live-cache').configureJourneyPersistence(journeyReliability.journal);
  const retry = setInterval(() => { void journeyReliability.flush(); }, 30000);
  retry.unref?.();
  void journeyReliability.flush();
}

if (config.wifiHomeDisplayPilotEnabled) {
  try { startWifiHomeDisplayPilot(getDb(), {
    recoverWalk: (points, batch, current, signal) => recoverHomeWifiWalk({
      db: getDb(), imei: config.wifiHomePilotImei, points, batch, current, signal,
      createAlert, flushJourneys,
    }),
  }); }
  catch { console.warn('[wifi-home-display] pilot unavailable; tracking continues'); }
}

startIntelligenceMonitor();

startHttpServer();

if (!config.firestoreDisabled) {
  startMetricsFlusher(config.opsMetricsFlushMs);
  startReminderScheduler(getDb(), { checkIntervalMs: 60000 });
}

if (config.careWellbeingIngestEnabled) {
  const wellbeingCleanupTimer = setInterval(() => {
    wellbeingStore.cleanupExpired().then(({ deleted }) => {
      if (deleted > 0) console.log(`[wellbeing] removed ${deleted} expired reading(s)`);
    }).catch((error) => {
      console.error('[wellbeing] retention cleanup failed:', error.message);
    });
  }, 6 * 60 * 60 * 1000);
  wellbeingCleanupTimer.unref?.();
}



setInterval(() => {

  const { skipped, persisted } = getWriteGateStats();

  if (skipped > 0 || persisted > 0) {

    console.log(`[write-gate] skipped ${skipped}, persisted ${persisted}`);

    recordWriteGate({ persisted, skipped });

  }

  resetWriteGateStats();

}, 60_000);



async function persistDeviceState(imei, patch, gateReason, session) {

  const sessionPatch = buildSessionPersistPatch(session, patch);

  await upsertDevice(imei, sessionPatch);

  if (session) session.lastPresenceAt = Date.now();

  recordPersist(imei, {

    location: patch.location,

    batteryPercent: patch.batteryPercent,

  });

  if (gateReason) {

    console.log(`[write-gate] persist ${imei} reason=${gateReason}`);

  }

}

/** While TCP is live, keep Online even when write-gate skips a full update. */
async function touchPresenceIfNeeded(imei, session) {
  const patch = buildPresenceTouchPatch(session);
  if (!patch) return false;
  await upsertDevice(imei, patch);
  console.log(`[presence] touch ${imei} (network session still live)`);
  return true;
}



async function maybeFlushDwell(imei, force = false) {

  const segment = flushDwellIfNeeded(imei, new Date(), force);

  if (segment) {

    await appendSegment(imei, segment);

  }

}



async function flushJourneys(imei, flushes) {

  if (journeyReliability) {
    for (const journey of flushes) journeyReliability.journal.queue(imei, journey);
    void journeyReliability.flush();
    return;
  }

  for (const journey of flushes) {

    await appendJourney(imei, journey);

    console.log(

      `[journey] ${imei} closed ${journey.closeReason} ` +

        `${journey.pointCount} pts ${journey.distanceKm} km`

    );

  }

}



function shouldAppendLocationHistory(gate) {

  if (!gate.appendHistory) return false;

  if (gate.reason === 'alarm' || gate.reason === 'geofence_transition' || gate.reason === 'first_fix') {

    return true;

  }

  return gate.reason === 'heartbeat_cap' && gate.appendHistory;

}



async function resolveGeolocation(event) {
  if (!event.needsGeolocation) return event;

  noteObservationForJourney(event.imei, 'approximatePacketsReceived');
  noteDiagnosticEventForJourney(
    event.imei,
    'approximate_packet_received',
    new Date(),
    {
      source: event.accuracySource || null,
      wifiCount: event.wifiAccessPoints?.length || 0,
      cellCount: event.cellTowers?.length || 0,
    }
  );

  const wifiCount = event.wifiAccessPoints?.length || 0;
  const cellCount = event.cellTowers?.length || 0;
  const geo = await geolocateFromV({
    wifiAccessPoints: event.wifiAccessPoints || [],
    cellTowers: event.cellTowers || [],
  });

  if (!geo) {
    noteObservationForJourney(event.imei, 'approximateResolutionFailed');
    noteDiagnosticEventForJourney(
      event.imei,
      'approximate_resolution_failed',
      new Date(),
      { wifiCount, cellCount }
    );
    console.log(
      `[geolocate] ${event.imei} wifi=${wifiCount} cells=${cellCount} → failed`
    );
    return null;
  }

  noteObservationForJourney(event.imei, 'approximateResolved');
  noteDiagnosticEventForJourney(
    event.imei,
    'approximate_resolved',
    new Date(),
    { source: event.accuracySource || null, wifiCount, cellCount }
  );

  const accLabel = geo.accuracyMeters != null ? `${Math.round(geo.accuracyMeters)}m` : '?';
  console.log(
    `[geolocate] ${event.imei} wifi=${wifiCount} cells=${cellCount} → ` +
      `${geo.lat.toFixed(3)}, ${geo.lng.toFixed(3)} acc=${accLabel}`
  );

  const recordedAt = event.location?.recordedAt || new Date();
  return {
    ...event,
    needsGeolocation: false,
    location: {
      ...(event.location || {}),
      lat: geo.lat,
      lng: geo.lng,
      accuracyMeters: geo.accuracyMeters,
      source: event.accuracySource,
      gpsValid: false,
      recordedAt,
    },
  };
}



// Tracking/reporting failures must not prevent a physical SOS from reaching
// createAlert. Keep the original error behavior for every other event type.
// Alert persistence and delivery are deliberately NOT wrapped by this helper.
async function runTrackingSideEffect(event, stage, operation) {
  try {
    return await operation();
  } catch (err) {
    if (event.type !== 'alarm' || event.alarmType !== 'sos') throw err;
    console.error(`[sos] ${stage} failed; continuing emergency alert:`, err.message);
    return null;
  }
}

async function applyEvents(events, session, packetArgs, receivedAt) {

  for (const event of events) {

    if (!event.imei && event.type !== 'crc_error') {

      console.warn('[gateway] event without IMEI', event.type);

      continue;

    }

    incrementEvent(event.type);



    try {

      const devicePatch = event.protocolId ? { protocolId: event.protocolId } : {};
      const eventReceivedAt = receivedAt || new Date();
      // Record before remote awaits. Old location reports belong to history,
      // never the current map, geofence alerts or adaptive reporting.
      const journeyRoute = event.type === 'location'
        ? journeyReliability?.route(event, eventReceivedAt, getHomeWifiPriority(event.imei)) : null;
      if (journeyRoute && !journeyRoute.live) {
        console.log(`[journey-ingress] ${JSON.stringify(journeyRoute)}`);
        continue;
      }
      // Observe the original packet before geolocation or write gating. This
      // synchronous, in-memory pilot must never interrupt tracking or SOS.
      try {
        observeWifiHomeEvent(event, eventReceivedAt, packetArgs);
      } catch {
        console.warn('[wifi-home] observer unavailable; tracking continues');
      }
      const telemetryValues = extractV52TelemetryValues(event);
      const telemetryPatch = buildV52TelemetryPatch(event, eventReceivedAt);

      if (event.imei) {
        const connectionAnnounced = await runTrackingSideEffect(event, 'connection', () => maybeAnnounceConnecting(
          session,
          event.imei,
          devicePatch,
          upsertDevice,
          onDeviceConnect,
          cancelPendingOffline,
          getDeviceDocument,
          seedLastKnownLocation
        ));
        if (connectionAnnounced) {
          noteDiagnosticEventForJourney(
            event.imei,
            'tcp_reconnected',
            eventReceivedAt,
            { protocolId: event.protocolId || null }
          );
        }
      }

      if (activityStepsStore && event.imei && event.stepsRaw != null) {
        try {
          // A slow supplementary write must not delay location or SOS. The
          // store serializes counters per watch and handles receipt ordering.
          void activityStepsStore.ingest(
            event,
            eventReceivedAt,
          ).then(activityResult => {
            if (activityResult.status === 'stored') {
              console.log(
                `[activity] ${event.imei} ${activityResult.day.localDate} ` +
                  `quality=${activityResult.day.quality}`
              );
            }
          }).catch(err => {
            console.warn(`[activity] ${event.imei} ingest failed: ${err.message}`);
          });
        } catch (err) {
          // Activity is supplementary. A malformed counter or Firestore issue
          // must never interrupt heartbeat, location or SOS processing.
          console.warn(`[activity] ${event.imei} ingest failed: ${err.message}`);
        }
      }

      if (event.type === 'location') {
        const resolved = await resolveGeolocation(event);
        if (!resolved?.location || typeof resolved.location.lat !== 'number') {
          continue;
        }
        const correctedEvent = correctFleetHemisphere(resolved);
        const provenancePatch = buildLocationProvenancePatch(
          correctedEvent.location,
          correctedEvent.accuracySource,
          correctedEvent.gpsValid
        );
        const locEvent = {
          ...correctedEvent,
          location: provenancePatch.location,
          accuracySource: provenancePatch.accuracySource,
        };
        noteDiagnosticEventForJourney(
          locEvent.imei,
          'location_received',
          eventReceivedAt,
          {
            source: locEvent.location.source || locEvent.accuracySource || null,
            gpsValid: locEvent.location.gpsValid === true,
            satellites: locEvent.location.satellites ?? null,
            batteryPercent: locEvent.batteryPercent ?? null,
          }
        );
        const accLabel = locEvent.location.accuracyMeters == null
          ? 'not supplied'
          : `${Math.round(locEvent.location.accuracyMeters)}m`;
        console.log(
          `[location] ${locEvent.imei} source=${locEvent.accuracySource} ` +
            `gps=${locEvent.gpsValid ? 'A' : 'V'} ` +
            `${locEvent.location.lat},${locEvent.location.lng} accuracy=${accLabel} ` +
            `observedAt=${new Date(locEvent.location.recordedAt).toISOString()} receivedAt=${eventReceivedAt.toISOString()}`
        );

        noteDeviceLocation(locEvent.imei, eventReceivedAt.getTime());

        updateLiveState(locEvent.imei, {

          location: locEvent.location,

          speedKmh: locEvent.speedKmh,

          accuracySource: locEvent.accuracySource,

          ...telemetryValues,

        });



        observeHomeWifiWalk?.(locEvent.imei,
          { ...locEvent.location, speedKmh: locEvent.speedKmh }, new Date());
        const db = getDb();
        let trackingDecision = selectHomeWifiTracking(locEvent.imei, locEvent.location,
          getHomeWifiPriority(locEvent.imei), new Date());
        if (trackingDecision.flushes.length) {
          await flushJourneys(locEvent.imei, trackingDecision.flushes);
        }

        let geofenceTransition = false;

        let exitTransition = null;

        let enterTransition = null;

        let geofencePresence = {
          hasActiveZones: false,
          insideAny: false,
          insideZoneIds: [],
        };

        if (db && locEvent.location && !trackingDecision.hold) {

          const transitions = await evaluateGeofenceTransitions(

            db,

            locEvent.imei,

            locEvent.location,
            { readHomeEvidence: () => getHomeWifiPriority(locEvent.imei) }

          );

          trackingDecision = selectHomeWifiTracking(locEvent.imei, locEvent.location,
            getHomeWifiPriority(locEvent.imei), new Date());
          if (trackingDecision.flushes.length) await flushJourneys(locEvent.imei, trackingDecision.flushes);
          geofenceTransition = !trackingDecision.hold && transitions.length > 0;
          geofencePresence = getGeofencePresence(locEvent.imei);

          for (const t of trackingDecision.hold ? [] : transitions) {

            console.log(`[geofence] ${locEvent.imei} ${t.type}: ${t.message}`);

            await createAlert(locEvent.imei, t);

            if (t.type === 'geofence_exit') {

              exitTransition = t;

            }

            if (t.type === 'geofence_enter') {

              enterTransition = t;

            }

          }

        }



        if (!trackingDecision.hold) trackPointForDwell(locEvent.imei, {

          lat: locEvent.location.lat,

          lng: locEvent.location.lng,

          speedKmh: locEvent.speedKmh,

          recordedAt: locEvent.location.recordedAt,

          geofenceId: exitTransition?.payload?.geofenceId || null,

          placeName: exitTransition?.payload?.geofenceName || null,

        });



        const now = new Date();

        const journeyTransition = isJourneyActive(locEvent.imei)
          ? (enterTransition || exitTransition)
          : (exitTransition || enterTransition);

        const journeyResult = trackingDecision.hold ? { flushes: [], started: false } : trackPointForJourney(

          locEvent.imei,

          {

            lat: locEvent.location.lat,

            lng: locEvent.location.lng,

            speedKmh: locEvent.speedKmh,

            accuracySource: locEvent.accuracySource,

            source: locEvent.location.source || locEvent.accuracySource,

            gpsValid: locEvent.location.gpsValid === true,

            accuracyMeters: locEvent.location.accuracyMeters,

            satellites: locEvent.location.satellites,

            recordedAt: locEvent.location.recordedAt,

          },

          now,

          {

            geofenceTransition: Boolean(journeyTransition),

            transitionType: journeyTransition?.type || null,

            geofenceName: journeyTransition?.payload?.geofenceName || null,

            geofenceId: journeyTransition?.payload?.geofenceId || null,

            transitionEvidence:
              journeyTransition?.payload?.observationEvidence || null,

            hasActiveSafeZones: geofencePresence.hasActiveZones,

            insideAnySafeZone: geofencePresence.insideAny,

            insideSafeZoneIds: geofencePresence.insideZoneIds,

            hasUncertainSafeZones: geofencePresence.hasUncertainZones,

          }

        );

        if (journeyResult.flushes.length) {

          await flushJourneys(locEvent.imei, journeyResult.flushes);

        }

        journeyReliability?.processed(locEvent.imei, journeyRoute?.id, trackingDecision.hold);



        const gate = shouldPersist(locEvent.imei, {

          eventType: 'location',

          location: locEvent.location,

          batteryPercent: locEvent.batteryPercent,

          geofenceTransition,

        });



        if (gate.persist || shouldForceSessionPersist(session)) {

          const locationIsSuspect = gate.reason === 'jump_suspect';

          if (locationIsSuspect) {
            console.warn(
              `[write-gate] ${locEvent.imei} suspect fix ${locEvent.location.lat},${locEvent.location.lng} `
              + `(>${JUMP_SANITY_METERS / 1000}km from last known) held back pending a corroborating fix`
            );
          }

          await persistDeviceState(

            locEvent.imei,

            {

              ...devicePatch,

              online: true,

              lastHeartbeatAt: eventReceivedAt,

              ...telemetryPatch,

              ...(locationIsSuspect ? {} : {

                ...provenancePatch,

                speedKmh: locEvent.speedKmh,

                course: locEvent.course,

              }),

            },

            gate.persist ? gate.reason : 'session_live',

            session

          );

          if (shouldAppendLocationHistory(gate)) {

            await appendLocation(locEvent.imei, {

              lat: locEvent.location.lat,

              lng: locEvent.location.lng,

              speedKmh: locEvent.speedKmh,

              altitude: locEvent.location.altitude,

              satellites: locEvent.location.satellites,

              accuracySource: locEvent.accuracySource,

              source: locEvent.location.source,

              gpsValid: locEvent.location.gpsValid,

              accuracyMeters: locEvent.location.accuracyMeters,

              recordedAt: locEvent.location.recordedAt,

            });

          }

          await refreshDeviceIntelligence(locEvent.imei, {

            ...getLiveDeviceState(locEvent.imei),

            lastHeartbeatAt: new Date(),

            location: locEvent.location,

            speedKmh: locEvent.speedKmh,

            accuracySource: locEvent.accuracySource,

            batteryPercent: locEvent.batteryPercent,

            ...telemetryValues,

          });

        } else {

          recordSkip();

          await touchPresenceIfNeeded(locEvent.imei, session);

        }



        if (!trackingDecision.hold) await maybeFlushDwell(locEvent.imei);
        const adaptiveDb = getDb();
        const outingActive = isJourneyActive(locEvent.imei);
        const journeyReturned =
          journeyResult.flushes.length > 0 && !outingActive;
        const adaptiveBattery =
          locEvent.batteryPercent ??
          getLiveDeviceState(locEvent.imei).batteryPercent;
        if (
          adaptiveDb &&
          (adaptiveBattery != null || outingActive || journeyReturned)
        ) {
            const reporting = await applyAdaptiveReporting(adaptiveDb, locEvent.imei, {
              batteryPercent: adaptiveBattery,
              outingActive,
              trigger: journeyReturned
                ? 'journey_return'
                : outingActive
                  ? 'journey_active'
                  : 'location',
              force: journeyReturned,
            });
            noteDiagnosticEventForJourney(
              locEvent.imei,
              'reporting_policy',
              eventReceivedAt,
              reporting
            );
        }

      } else if (event.type === 'heartbeat') {

        noteDiagnosticEventForJourney(
          event.imei,
          'heartbeat_received',
          eventReceivedAt,
          { batteryPercent: event.batteryPercent ?? null }
        );

        updateLiveState(event.imei, {

          ...telemetryValues,

          accuracySource: event.accuracySource,

        });



        const gate = shouldPersist(event.imei, {

          eventType: 'heartbeat',

          batteryPercent: event.batteryPercent,

        });



        if (gate.persist || shouldForceSessionPersist(session)) {

          const liveState = getLiveDeviceState(event.imei);

          await persistDeviceState(

            event.imei,

            {

              ...devicePatch,

              online: true,

              lastHeartbeatAt: eventReceivedAt,

              ...telemetryPatch,

              ...(event.accuracySource ? { accuracySource: event.accuracySource } : {}),

              // On heartbeat_cap, include current location if available (keeps location fresh even when stationary)

              ...(gate.includeLocation && liveState.location ? { location: liveState.location } : {}),

            },

            gate.persist ? gate.reason : 'session_live',

            session

          );

          await refreshDeviceIntelligence(event.imei, {

            ...getLiveDeviceState(event.imei),

            lastHeartbeatAt: new Date(),

            ...telemetryValues,

            ...(event.accuracySource ? { accuracySource: event.accuracySource } : {}),

          });

        } else {

          recordSkip();

          await touchPresenceIfNeeded(event.imei, session);

        }

        if (event.batteryPercent != null) {
          const db = getDb();
          if (db) {
            const reporting = await applyAdaptiveReporting(db, event.imei, {
              batteryPercent: event.batteryPercent,
              outingActive: isJourneyActive(event.imei),
              trigger: isJourneyActive(event.imei)
                ? 'journey_heartbeat'
                : 'heartbeat',
            });
            noteDiagnosticEventForJourney(
              event.imei,
              'reporting_policy',
              eventReceivedAt,
              reporting
            );
          }
        }
      } else if (event.type === 'alarm') {

        // Capture pre-alarm evidence before geolocation/reporting/persistence
        // can yield to a later watch observation. Never read it at send time.
        let sosDeviceAtReceipt = null;
        if (event.alarmType === 'sos') {
          sosDeviceAtReceipt = { ...getLiveDeviceState(event.imei) };
          try {
            sosDeviceAtReceipt = await getDeviceDocument(event.imei)
              || sosDeviceAtReceipt;
          } catch (err) {
            console.error('[sos] location evidence lookup failed:', err.message);
          }
        }

        let alarmEvent = event;
        if (event.needsGeolocation) {
          const resolved = await runTrackingSideEffect(event, 'geolocation', () => resolveGeolocation(event));
          if (resolved?.location && typeof resolved.location.lat === 'number') {
            alarmEvent = resolved;
          } else {
            alarmEvent = { ...event, location: undefined };
          }
        } else if (alarmEvent.location) {
          alarmEvent = correctFleetHemisphere(alarmEvent);
        }

        const alarmProvenance = alarmEvent.location
          ? buildLocationProvenancePatch(
              alarmEvent.location,
              alarmEvent.accuracySource,
              alarmEvent.gpsValid
            )
          : {};
        if (alarmProvenance.location) {
          alarmEvent = {
            ...alarmEvent,
            location: alarmProvenance.location,
            accuracySource: alarmProvenance.accuracySource,
          };
        }

        const alarmType = alarmEvent.alarmType || 'other';
        const alarmAt = alarmType === 'sos' ? eventReceivedAt : new Date();
        const sosLocationSnapshot = alarmType === 'sos'
          ? buildSosLocationSnapshot(sosDeviceAtReceipt, {
              now: alarmAt,
              observation: alarmProvenance.location ? {
                ...alarmProvenance.location,
                // A resolver completion time is not a device observation time.
                recordedAt: event.location?.recordedAt || null,
              } : null,
            })
          : null;
        if (alarmType === 'sos') {
          const adaptiveDb = getDb();
          if (adaptiveDb) {
            await runTrackingSideEffect(event, 'reporting', () => activateSosOverride(adaptiveDb, alarmEvent.imei, {
              batteryPercent: alarmEvent.batteryPercent,
              outingActive: isJourneyActive(alarmEvent.imei),
            }));
          }
        }

        const alarmRaw =

          alarmEvent.alarmCode != null ? { raw: { alarmCode: alarmEvent.alarmCode } } : {};

        let alarmPayload =

          alarmEvent.alarmCode != null ? { alarmCode: alarmEvent.alarmCode } : {};



        if (alarmEvent.location) {

          updateLiveState(alarmEvent.imei, {

            location: alarmEvent.location,

            speedKmh: alarmEvent.speedKmh,

            accuracySource: alarmEvent.accuracySource,

            ...telemetryValues,

          });

        }



        const alarmPatch = {

          ...devicePatch,

          online: true,

          lastHeartbeatAt: alarmAt,

          ...telemetryPatch,

          ...(alarmEvent.location
            ? {
                ...alarmProvenance,
                speedKmh: alarmEvent.speedKmh,
                course: alarmEvent.course,
              }
            : {}),

          lastAlarm: {

            type: alarmType,

            at: alarmAt,

            ...alarmRaw,

          },

        };



        await runTrackingSideEffect(event, 'persistence', () =>
          persistDeviceState(alarmEvent.imei, alarmPatch, 'alarm', session));

        if (alarmType === 'fall') {
          let deviceAtFall = null;
          try {
            deviceAtFall = await getDeviceDocument(alarmEvent.imei);
          } catch (err) {
            console.error(
              `[fall] device snapshot lookup failed for ${alarmEvent.imei}: ${err.message}`
            );
          }
          alarmPayload = withFallLocationSnapshot(
            alarmType,
            alarmPayload,
            deviceAtFall || {
              ...getLiveDeviceState(alarmEvent.imei),
              ...alarmPatch,
            },
            { now: alarmAt }
          );
        }

        if (alarmEvent.location) {

          await runTrackingSideEffect(event, 'history', () => appendLocation(alarmEvent.imei, {

            lat: alarmEvent.location.lat,

            lng: alarmEvent.location.lng,

            speedKmh: alarmEvent.speedKmh,

            altitude: alarmEvent.location.altitude,

            satellites: alarmEvent.location.satellites,

            accuracySource: alarmEvent.accuracySource,

            source: alarmEvent.location.source,

            gpsValid: alarmEvent.location.gpsValid,

            accuracyMeters: alarmEvent.location.accuracyMeters,

            recordedAt: alarmEvent.location.recordedAt,

          }));

        }

        await runTrackingSideEffect(event, 'intelligence', () => refreshDeviceIntelligence(alarmEvent.imei, {

          ...getLiveDeviceState(alarmEvent.imei),

          online: true,

          lastHeartbeatAt: new Date(),

          location: alarmEvent.location,

          speedKmh: alarmEvent.speedKmh,

          accuracySource: alarmEvent.accuracySource,

          batteryPercent: alarmEvent.batteryPercent,

          ...telemetryValues,

        }));



        const sosIncident = alarmType === 'sos'
          ? claimSosIncident(alarmEvent.imei, { nowMs: alarmAt.getTime() })
          : { accepted: true };

        if (sosIncident.accepted) {
          await createAlert(alarmEvent.imei, {

            type: alarmType,

            severity: alarmEvent.severity || 'warning',

            message: `Device alarm: ${alarmType}`,

            eventAt: alarmAt,

            payload: alarmPayload,

            ...(sosLocationSnapshot ? { sosLocationSnapshot } : {}),

          });
        } else {
          console.log(
            `[sos] duplicate packet collapsed for ${alarmEvent.imei}; ` +
              `retry window ${Math.ceil(sosIncident.retryAfterMs / 1000)}s`
          );
        }

      } else if (event.type === 'health_reading' && wellbeingStore) {

        const result = await wellbeingStore.ingest(event, eventReceivedAt);
        // Health values are deliberately excluded from routine logs. The
        // acceptance inspector reads protected evidence after explicit consent.
        console.log(
          `[wellbeing] ${event.imei} metric=${result.metricSet || event.metric || 'unknown'} ` +
            `status=${result.status}`
        );

      } else if (event.type === 'crc_error') {

        console.warn('[gateway] CRC mismatch — frame dropped');

      } else if (event.type === 'parse_error') {

        console.warn(`[gateway] parse error: ${event.error}`);

      } else if (event.type === 'location_parse_error') {

        const detail =

          event.reason === 'gps_not_fixed'

            ? 'GPS not fixed (V)'

            : event.reason || 'parse error';

        const gps = event.gpsFlag != null ? ` gps=${event.gpsFlag}` : '';

        const fields = event.argCount != null ? ` fields=${event.argCount}` : '';

        const preview = event.payloadPreview

          ? ` payload="${event.payloadPreview}"`

          : '';

        console.warn(

          `[gateway] ${event.imei} location parse failed (${event.command}): ${detail}${gps}${fields}${preview}`

        );

      } else if (event.type === 'imei_report') {

        await upsertDevice(event.imei, {

          protocolId: event.protocolId,

          fullImei: event.fullImei,

        });

        console.log(

          `[gateway] full IMEI ${event.fullImei} for protocol id ${event.protocolId}`

        );

      } else if (event.type === 'command_echo') {

        console.log(

          `[gateway] ${event.protocolId || event.imei} echoed back ${event.command} (dropped, not re-acking)`

        );

      } else if (event.type === 'unknown_command') {

        console.log(

          `[gateway] unknown command: ${event.command} from ${event.protocolId || event.imei}`

        );

      } else if (event.type === 'unknown') {

        console.log(`[gateway] unknown protocol 0x${Number(event.protocol).toString(16)}`);

      }

    } catch (err) {

      console.error('[gateway] failed to apply event', event.type, err.message);

    }

  }

}



const server = net.createServer((socket) => {

  const remote = `${socket.remoteAddress}:${socket.remotePort}`;

  const connectedAt = new Date().toISOString();
  let lastDataAt = null;
  let peerEndAt = null;
  let socketErrorCode = null;

  console.log(`[tcp] connected ${remote} at=${connectedAt}`);

  registerSession(socket, {
    onRecoveryProbe: ({ imei, protocolId, reason }) => {
      const target = imei || protocolId;
      if (!target) return { ok: false, error: 'identity_pending' };
      const result = sendContinuousReporting(target);
      if (result.ok) {
        noteDiagnosticEventForJourney(
          target,
          'recovery_probe_sent',
          new Date(),
          { reason }
        );
        console.warn(
          `[recovery] ${target} CR requested after ${reason}`
        );
      }
      return result;
    },
  });



  socket.on('data', (chunk) => {

    const session = getSession(socket);

    if (!session) return;

    lastDataAt = new Date().toISOString();

    noteSessionPacket(socket);

    session.buffer = Buffer.concat([session.buffer, chunk]);

    touchSessionActivity(socket);

    const { frames, rest } = extractFrames(session.buffer);

    session.buffer = Buffer.from(rest);



    for (const frame of frames) {

      const decoded = decodeFrame(frame);

      const { acks, events } = handlePacket(decoded, session);

      const receivedAt = new Date();
      const capturedAlarm = wearCapture?.observePacket({
        socket, session, frame, decoded, receivedAt,
      });
      try { wearEvidence.capture(decoded, events, session, receivedAt); }
      catch { console.warn('[wear-evidence] unavailable; wearing remains unconfirmed'); }
      if (journeyReliability) {
        try {
          for (const event of events) if (event.type === 'location') {
            journeyReliability.capture(event, receivedAt, getHomeWifiPriority(event.imei));
          }
        } catch (error) {
          console.error(`[journey-durability] GPS evidence not committed: ${error.message}`);
          // Alarms bypass history persistence and remain acknowledged/delivered.
          if (!events.some(e => e.type === 'alarm')) continue;
        }
      }

      // Bounded admin-started evidence capture. It never changes decoded events,
      // ACKs or customer state, and isolates all diagnostic failures internally.
      observeWifiFencePacket(decoded, events);

      for (const ack of acks) {

        if (capturedAlarm) wearCapture.writeAlarmAck(socket, ack, capturedAlarm);
        else socket.write(ack);

      }

      // Optional private payload capture runs after ACKs and never awaits I/O in
      // the packet path. It does not modify events, readings or notifications.
      try { temperatureCapture?.observe(decoded, session, receivedAt); }
      catch { console.warn('[temperature-capture] capture_failed'); }
      try { wellnessRoutine?.observe(decoded, session); }
      catch { console.warn('[wellness-routine] observation_failed'); }

      // Independent of capture success and request flags; preserve exclusion
      // on the receipt event even if it is applied after the trial resumes.
      temperatureTrialQuarantine.markEvents(events);
      const apply = () => applyEvents(events, session, decoded.args, receivedAt);
      const pending = journeyReliability && events.some(e => e.type === 'location') &&
          !events.some(e => e.type === 'alarm')
        ? journeyReliability.enqueue(events.find(e => e.imei)?.imei, apply) : apply();
      pending.catch((err) => {

        console.error('[gateway] applyEvents', err);

      });

    }

  });



  // The peer here may be a tunnel agent. An end event records transport
  // evidence; it cannot identify the watch, carrier or tunnel as the cause.
  socket.on('end', () => {
    peerEndAt = new Date().toISOString();
    wearCapture?.observeSocket('peer_end', socket, getSession(socket), {
      connectedAt, lastDataAt, peerEndAt,
    });
  });

  socket.on('error', (err) => {

    socketErrorCode = typeof err.code === 'string' ? err.code : 'unknown';
    wearCapture?.observeSocket('socket_error', socket, getSession(socket), {
      connectedAt, lastDataAt, peerEndAt, socketErrorCode,
    });
    console.error(
      `[tcp] error ${remote} at=${new Date().toISOString()} code=${socketErrorCode}:`,
      err.message
    );

  });



  socket.on('close', (hadError) => {

    const session = getSession(socket);
    wearCapture?.observeSocket('socket_closed', socket, session, {
      connectedAt, lastDataAt, peerEndAt, hadError, socketErrorCode,
      localCloseReason: session?.localCloseReason,
      localCloseRequestedAt: session?.localCloseRequestedAt,
      bytesRead: socket.bytesRead, bytesWritten: socket.bytesWritten,
    });

    console.log(
      `[tcp] disconnected ${remote} imei=${session?.imei || 'unknown'} ` +
      JSON.stringify({
        at: new Date().toISOString(),
        connectedAt,
        lastDataAt,
        peerEndAt,
        hadError: hadError === true,
        socketErrorCode,
        localCloseReason: session?.localCloseReason || null,
        localCloseRequestedAt: session?.localCloseRequestedAt || null,
        bytesRead: socket.bytesRead,
        bytesWritten: socket.bytesWritten,
      })
    );

    // A replacement TCP connection can already be reporting when this older
    // socket closes. Remove only this socket before deciding device-wide state.
    unregisterSession(socket);

    if (session?.imei) {
      wearEvidence.disconnect(session.imei, session);

      const remainingSessions = findSocketsForDevice(session.imei)
        .filter(({ socket: remaining }) => !remaining.destroyed);
      if (remainingSessions.length > 0) {
        console.log(
          `[tcp] device remains connected imei=${session.imei} sessions=${remainingSessions.length}`
        );
        return;
      }

      noteDiagnosticEventForJourney(
        session.imei,
        'tcp_disconnected',
        new Date(),
        { reachedLive: (session.persistCount || 0) >= SESSION_LIVE_PACKETS }
      );

      maybeFlushDwell(session.imei, true).catch((err) => {

        console.error('[gateway] dwell flush on disconnect failed', err.message);

      });

      const journey = flushJourneyIfNeeded(session.imei, new Date(), true);

      if (journey) {

        appendJourney(session.imei, journey).catch((err) => {

          console.error('[gateway] journey flush on disconnect failed', err.message);

        });

      }

      const reachedLive = (session.persistCount || 0) >= SESSION_LIVE_PACKETS;
      if (reachedLive) {
        scheduleDeviceOffline(
          session.imei,
          upsertDevice,
          config.offlineDebounceMs,
          getDeviceDocument
        );
      }

      onDeviceDisconnect(session.imei);

    }

  });

});



server.on('error', (err) => {

  console.error('[tcp] server error', err);

  process.exit(1);

});



server.listen(config.port, config.host, () => {

  console.log(`[guardian-gateway] listening on ${config.host}:${config.port}`);

  console.log(`[guardian-gateway] firestore ${config.firestoreDisabled ? 'OFF (dry-run)' : 'ON'}`);

  console.log(
    `[connection-policy] fallbackIdle=${config.tcpIdleMinutes}m ` +
      `recoveryGrace=${config.tcpRecoveryGraceSeconds}s ` +
      `outingLocationStale=${config.outingLocationStaleSeconds}s`
  );

  console.log(

    `[write-gate] min=${config.writeGateMinMetres}m heartbeat=${config.writeGateHeartbeatMinutes}min history=${config.writeGateHistoryMinutes}min dwell=${config.dwellMinMinutes}min journeyIdle=${config.journeyIdleMinutes}min`

  );

  logNgrokHint(config.port).catch(() => {});

});

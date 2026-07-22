const net = require('net');

const config = require('./config');

const { extractFrames, decodeFrame, handlePacket } = require('./protocol/gt06');

const {

  initFirestore,

  getDb,

  upsertDevice,

  appendLocation,

  appendSegment,

  appendJourney,

  createAlert,

  refreshDeviceIntelligence,

  startIntelligenceMonitor,

} = require('./firestore');

const { evaluateGeofenceTransitions } = require('./geofence');

const { startHttpServer } = require('./http');

const {

  registerSession,

  unregisterSession,

  getSession,

} = require('./sessions');

const {

  onDeviceConnect,

  onDeviceDisconnect,

  updateLiveState,

  getLiveDeviceState,

  shouldPersist,

  recordPersist,

  recordSkip,

  trackPointForDwell,

  flushDwellIfNeeded,

  trackPointForJourney,

  flushJourneyIfNeeded,

  getWriteGateStats,

  resetWriteGateStats,

} = require('./live-cache');



initFirestore();

startIntelligenceMonitor();

startHttpServer();



setInterval(() => {

  const { skipped, persisted } = getWriteGateStats();

  if (skipped > 0 || persisted > 0) {

    console.log(`[write-gate] skipped ${skipped}, persisted ${persisted}`);

  }

  resetWriteGateStats();

}, 60_000);



async function persistDeviceState(imei, patch, gateReason) {

  await upsertDevice(imei, patch);

  recordPersist(imei, {

    location: patch.location,

    batteryPercent: patch.batteryPercent,

  });

  if (gateReason) {

    console.log(`[write-gate] persist ${imei} reason=${gateReason}`);

  }

}



async function maybeFlushDwell(imei, force = false) {

  const segment = flushDwellIfNeeded(imei, new Date(), force);

  if (segment) {

    await appendSegment(imei, segment);

  }

}



async function flushJourneys(imei, flushes) {

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



async function applyEvents(events) {

  for (const event of events) {

    if (!event.imei && event.type !== 'crc_error') {

      console.warn('[gateway] event without IMEI', event.type);

      continue;

    }



    try {

      const devicePatch = event.protocolId ? { protocolId: event.protocolId } : {};



      if (event.type === 'login') {

        onDeviceConnect(event.imei);

        await persistDeviceState(

          event.imei,

          {

            ...devicePatch,

            online: true,

            lastHeartbeatAt: new Date(),

            createdAt: new Date(),

          },

          'login'

        );

      } else if (event.type === 'location') {

        updateLiveState(event.imei, {

          location: event.location,

          speedKmh: event.speedKmh,

          accuracySource: event.accuracySource,

        });



        const db = getDb();

        let geofenceTransition = false;

        let exitTransition = null;

        if (db && event.location) {

          const transitions = await evaluateGeofenceTransitions(

            db,

            event.imei,

            event.location

          );

          geofenceTransition = transitions.length > 0;

          for (const t of transitions) {

            console.log(`[geofence] ${event.imei} ${t.type}: ${t.message}`);

            await createAlert(event.imei, t);

            if (t.type === 'geofence_exit') {

              exitTransition = t;

            }

          }

        }



        trackPointForDwell(event.imei, {

          lat: event.location.lat,

          lng: event.location.lng,

          speedKmh: event.speedKmh,

          recordedAt: event.location.recordedAt,

          geofenceId: exitTransition?.payload?.geofenceId || null,

          placeName: exitTransition?.payload?.geofenceName || null,

        });



        const now = new Date();

        const journeyResult = trackPointForJourney(

          event.imei,

          {

            lat: event.location.lat,

            lng: event.location.lng,

            speedKmh: event.speedKmh,

            accuracySource: event.accuracySource,

            recordedAt: event.location.recordedAt,

          },

          now,

          {

            geofenceTransition: Boolean(exitTransition),

            transitionType: exitTransition ? 'geofence_exit' : null,

            geofenceName: exitTransition?.payload?.geofenceName || null,

            geofenceId: exitTransition?.payload?.geofenceId || null,

          }

        );

        if (journeyResult.flushes.length) {

          await flushJourneys(event.imei, journeyResult.flushes);

        }



        const gate = shouldPersist(event.imei, {

          eventType: 'location',

          location: event.location,

          batteryPercent: event.batteryPercent,

          geofenceTransition,

        });



        if (gate.persist) {

          await persistDeviceState(

            event.imei,

            {

              ...devicePatch,

              online: true,

              lastHeartbeatAt: new Date(),

              location: event.location,

              speedKmh: event.speedKmh,

              course: event.course,

              accuracySource: event.accuracySource,

              ...(event.batteryPercent != null

                ? { batteryPercent: event.batteryPercent }

                : {}),

            },

            gate.reason

          );

          if (shouldAppendLocationHistory(gate)) {

            await appendLocation(event.imei, {

              lat: event.location.lat,

              lng: event.location.lng,

              speedKmh: event.speedKmh,

              accuracySource: event.accuracySource,

              recordedAt: event.location.recordedAt,

            });

          }

          await refreshDeviceIntelligence(event.imei, {

            ...getLiveDeviceState(event.imei),

            lastHeartbeatAt: new Date(),

            location: event.location,

            speedKmh: event.speedKmh,

            accuracySource: event.accuracySource,

            batteryPercent: event.batteryPercent,

          });

        } else {

          recordSkip();

        }



        await maybeFlushDwell(event.imei);

      } else if (event.type === 'heartbeat') {

        updateLiveState(event.imei, {

          batteryPercent: event.batteryPercent,

          accuracySource: event.accuracySource,

        });



        const gate = shouldPersist(event.imei, {

          eventType: 'heartbeat',

          batteryPercent: event.batteryPercent,

        });



        if (gate.persist) {

          await persistDeviceState(

            event.imei,

            {

              ...devicePatch,

              online: true,

              lastHeartbeatAt: new Date(),

              batteryPercent: event.batteryPercent,

              ...(event.accuracySource ? { accuracySource: event.accuracySource } : {}),

            },

            gate.reason

          );

          await refreshDeviceIntelligence(event.imei, {

            ...getLiveDeviceState(event.imei),

            lastHeartbeatAt: new Date(),

            batteryPercent: event.batteryPercent,

            ...(event.accuracySource ? { accuracySource: event.accuracySource } : {}),

          });

        } else {

          recordSkip();

        }

      } else if (event.type === 'alarm') {

        const alarmType = event.alarmType || 'other';

        const alarmRaw =

          event.alarmCode != null ? { raw: { alarmCode: event.alarmCode } } : {};

        const alarmPayload =

          event.alarmCode != null ? { alarmCode: event.alarmCode } : {};



        if (event.location) {

          updateLiveState(event.imei, {

            location: event.location,

            speedKmh: event.speedKmh,

            accuracySource: event.accuracySource,

          });

        }



        const alarmPatch = event.location

          ? {

              ...devicePatch,

              online: true,

              lastHeartbeatAt: new Date(),

              location: event.location,

              speedKmh: event.speedKmh,

              course: event.course,

              accuracySource: event.accuracySource,

              lastAlarm: {

                type: alarmType,

                at: new Date(),

                ...alarmRaw,

              },

            }

          : {

              ...devicePatch,

              online: true,

              lastAlarm: {

                type: alarmType,

                at: new Date(),

                ...alarmRaw,

              },

            };



        await persistDeviceState(event.imei, alarmPatch, 'alarm');

        if (event.location) {

          await appendLocation(event.imei, {

            lat: event.location.lat,

            lng: event.location.lng,

            speedKmh: event.speedKmh,

            accuracySource: event.accuracySource,

            recordedAt: event.location.recordedAt,

          });

        }

        await refreshDeviceIntelligence(event.imei, {

          ...getLiveDeviceState(event.imei),

          online: true,

          lastHeartbeatAt: new Date(),

          location: event.location,

          speedKmh: event.speedKmh,

          accuracySource: event.accuracySource,

          batteryPercent: event.batteryPercent,

        });



        await createAlert(event.imei, {

          type: alarmType,

          severity: event.severity || 'warning',

          message: `Device alarm: ${alarmType}`,

          payload: alarmPayload,

        });

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

        await persistDeviceState(

          event.imei,

          {

            online: true,

            protocolId: event.protocolId,

            fullImei: event.fullImei,

          },

          'imei_report'

        );

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

  console.log(`[tcp] connected ${remote}`);

  registerSession(socket);



  socket.on('data', (chunk) => {

    const session = getSession(socket);

    if (!session) return;



    session.buffer = Buffer.concat([session.buffer, chunk]);

    const { frames, rest } = extractFrames(session.buffer);

    session.buffer = Buffer.from(rest);



    for (const frame of frames) {

      const decoded = decodeFrame(frame);

      const { acks, events } = handlePacket(decoded, session);

      for (const ack of acks) {

        socket.write(ack);

      }

      applyEvents(events).catch((err) => {

        console.error('[gateway] applyEvents', err);

      });

    }

  });



  socket.on('error', (err) => {

    console.error(`[tcp] error ${remote}:`, err.message);

  });



  socket.on('close', () => {

    const session = getSession(socket);

    console.log(`[tcp] disconnected ${remote} imei=${session?.imei || 'unknown'}`);

    if (session?.imei) {

      maybeFlushDwell(session.imei, true).catch((err) => {

        console.error('[gateway] dwell flush on disconnect failed', err.message);

      });

      const journey = flushJourneyIfNeeded(session.imei, new Date(), true);

      if (journey) {

        appendJourney(session.imei, journey).catch((err) => {

          console.error('[gateway] journey flush on disconnect failed', err.message);

        });

      }

      upsertDevice(session.imei, { online: false }).catch((err) => {

        console.error('[gateway] offline update failed', err.message);

      });

      onDeviceDisconnect(session.imei);

    }

    unregisterSession(socket);

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

    `[write-gate] min=${config.writeGateMinMetres}m heartbeat=${config.writeGateHeartbeatMinutes}min history=${config.writeGateHistoryMinutes}min dwell=${config.dwellMinMinutes}min journeyIdle=${config.journeyIdleMinutes}min`

  );

});


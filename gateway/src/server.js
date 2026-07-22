const net = require('net');
const config = require('./config');
const { extractFrames, decodeFrame, handlePacket } = require('./protocol/gt06');
const {
  initFirestore,
  getDb,
  upsertDevice,
  appendLocation,
  createAlert,
} = require('./firestore');
const { evaluateGeofenceTransitions } = require('./geofence');
const { startHttpServer } = require('./http');
const {
  registerSession,
  unregisterSession,
  getSession,
} = require('./sessions');

initFirestore();
startHttpServer();

async function applyEvents(events) {
  for (const event of events) {
    if (!event.imei && event.type !== 'crc_error') {
      console.warn('[gateway] event without IMEI', event.type);
      continue;
    }

    try {
      const devicePatch = event.protocolId ? { protocolId: event.protocolId } : {};

      if (event.type === 'login') {
        await upsertDevice(event.imei, {
          ...devicePatch,
          online: true,
          lastHeartbeatAt: new Date(),
          createdAt: new Date(),
        });
      } else if (event.type === 'location') {
        await upsertDevice(event.imei, {
          ...devicePatch,
          online: true,
          lastHeartbeatAt: new Date(),
          location: event.location,
          speedKmh: event.speedKmh,
          course: event.course,
          accuracySource: event.accuracySource,
        });
        await appendLocation(event.imei, {
          lat: event.location.lat,
          lng: event.location.lng,
          speedKmh: event.speedKmh,
          accuracySource: event.accuracySource,
          recordedAt: event.location.recordedAt,
        });

        const db = getDb();
        if (db && event.location) {
          const transitions = await evaluateGeofenceTransitions(
            db,
            event.imei,
            event.location
          );
          for (const t of transitions) {
            console.log(`[geofence] ${event.imei} ${t.type}: ${t.message}`);
            await createAlert(event.imei, t);
          }
        }
      } else if (event.type === 'heartbeat') {
        await upsertDevice(event.imei, {
          ...devicePatch,
          online: true,
          lastHeartbeatAt: new Date(),
          batteryPercent: event.batteryPercent,
          ...(event.accuracySource ? { accuracySource: event.accuracySource } : {}),
        });
      } else if (event.type === 'alarm') {
        const alarmType = event.alarmType || 'other';
        const alarmRaw =
          event.alarmCode != null ? { raw: { alarmCode: event.alarmCode } } : {};
        const alarmPayload =
          event.alarmCode != null ? { alarmCode: event.alarmCode } : {};
        if (event.location) {
          await upsertDevice(event.imei, {
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
          });
        } else {
          await upsertDevice(event.imei, {
            ...devicePatch,
            online: true,
            lastAlarm: {
              type: alarmType,
              at: new Date(),
              ...alarmRaw,
            },
          });
        }

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
        await upsertDevice(event.imei, {
          online: true,
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
      upsertDevice(session.imei, { online: false }).catch((err) => {
        console.error('[gateway] offline update failed', err.message);
      });
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
});

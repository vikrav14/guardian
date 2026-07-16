const net = require('net');
const config = require('./config');
const { extractFrames, decodeFrame, handlePacket } = require('./protocol/gt06');
const {
  initFirestore,
  upsertDevice,
  appendLocation,
  createAlert,
} = require('./firestore');

initFirestore();

const sessions = new Map(); // socket -> { imei, buffer }

async function applyEvents(events) {
  for (const event of events) {
    if (!event.imei && event.type !== 'crc_error') {
      console.warn('[gateway] event without IMEI', event.type);
      continue;
    }

    try {
      if (event.type === 'login') {
        await upsertDevice(event.imei, {
          online: true,
          lastHeartbeatAt: new Date(),
          createdAt: new Date(),
        });
      } else if (event.type === 'location') {
        await upsertDevice(event.imei, {
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
      } else if (event.type === 'heartbeat') {
        await upsertDevice(event.imei, {
          online: true,
          lastHeartbeatAt: new Date(),
          batteryPercent: event.batteryPercent,
          ...(event.accuracySource ? { accuracySource: event.accuracySource } : {}),
        });
      } else if (event.type === 'alarm') {
        const alarmType = event.alarmType || 'other';
        if (event.location) {
          await upsertDevice(event.imei, {
            online: true,
            lastHeartbeatAt: new Date(),
            location: event.location,
            speedKmh: event.speedKmh,
            course: event.course,
            accuracySource: event.accuracySource,
            lastAlarm: {
              type: alarmType,
              at: new Date(),
              raw: { alarmCode: event.alarmCode },
            },
          });
        } else {
          await upsertDevice(event.imei, {
            online: true,
            lastAlarm: {
              type: alarmType,
              at: new Date(),
              raw: { alarmCode: event.alarmCode },
            },
          });
        }

        await createAlert(event.imei, {
          type: alarmType,
          severity: event.severity || 'warning',
          message: `Device alarm: ${alarmType}`,
          payload: { alarmCode: event.alarmCode },
        });
      } else if (event.type === 'crc_error') {
        console.warn('[gateway] CRC mismatch — frame dropped');
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
  sessions.set(socket, { imei: null, buffer: Buffer.alloc(0) });

  socket.on('data', (chunk) => {
    const session = sessions.get(socket);
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
    const session = sessions.get(socket);
    console.log(`[tcp] disconnected ${remote} imei=${session?.imei || 'unknown'}`);
    if (session?.imei) {
      upsertDevice(session.imei, { online: false }).catch((err) => {
        console.error('[gateway] offline update failed', err.message);
      });
    }
    sessions.delete(socket);
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

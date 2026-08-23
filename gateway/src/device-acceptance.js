'use strict';

const ACCEPTANCE_STATUS = Object.freeze({
  PASSED: 'passed',
  PENDING: 'pending',
  PARTIAL: 'partial',
  MANUAL_REQUIRED: 'manual_required',
});

const DEFAULT_HEARTBEAT_FRESH_MS = 5 * 60 * 1000;

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asIso(value) {
  return asDate(value)?.toISOString() || null;
}

function eventAt(value) {
  return asDate(
    value?.eventAt || value?.createdAt || value?.completedAt ||
      value?.updatedAt || value?.recordedAt || value?.observedAt ||
      value?.receivedAt
  );
}

function after(value, since) {
  const at = eventAt(value);
  return Boolean(at && at.getTime() >= since.getTime());
}

function newest(values) {
  return [...values].sort((a, b) =>
    (eventAt(b)?.getTime() || 0) - (eventAt(a)?.getTime() || 0)
  )[0] || null;
}

function summarizeAlert(alert) {
  if (!alert) return null;
  return {
    id: alert.id || null,
    type: alert.type || null,
    severity: alert.severity || null,
    notifyStatus: alert.notifyStatus || null,
    eventAt: asIso(alert.eventAt || alert.createdAt),
  };
}

function summarizeCommand(command) {
  if (!command) return null;
  return {
    id: command.id || null,
    type: command.type || null,
    status: command.status || null,
    channel: command.result?.channel || null,
    createdAt: asIso(command.createdAt),
    completedAt: asIso(command.completedAt),
  };
}

function summarizeReminder(reminder) {
  if (!reminder) return null;
  return {
    id: reminder.id || null,
    enabled: reminder.enabled !== false,
    time: reminder.time || null,
    frequency: reminder.frequency ?? null,
    createdAt: asIso(reminder.createdAt),
    updatedAt: asIso(reminder.updatedAt),
    lastSentAt: asIso(reminder.lastSentAt),
    acknowledgementStatus: reminder.acknowledgementStatus || null,
  };
}

function channelEvidence(logs, type, since) {
  const matching = logs.filter((log) =>
    String(log.alertType || '').toLowerCase() === type && after(log, since)
  );
  const latest = newest(matching);
  if (!latest) return null;

  const channels = [];
  for (const result of Array.isArray(latest.results) ? latest.results : []) {
    for (const [channel, outcome] of Object.entries(result.channels || {})) {
      channels.push({
        channel,
        ok: outcome?.ok === true,
        accepted: outcome?.accepted === true,
        skipped: outcome?.skipped === true,
        reason: outcome?.reason || null,
        provider: outcome?.provider || null,
        transport: outcome?.transport || null,
        messageId: outcome?.messageId || null,
        deliveryStatus: outcome?.deliveryStatus || null,
        acceptedAt: asIso(outcome?.acceptedAt),
        deliveredAt: asIso(outcome?.deliveredAt),
        readAt: asIso(outcome?.readAt),
        failedAt: asIso(outcome?.failedAt),
        errors: outcome?.deliveryErrors || [],
      });
    }
  }
  return {
    createdAt: asIso(latest.createdAt),
    contactCount: Number(latest.contactCount || 0),
    channels,
  };
}

function alertCapability(type, alerts, notificationLogs, since) {
  const matching = alerts.filter((alert) =>
    String(alert.type || '').toLowerCase() === type && after(alert, since)
  );
  const alert = newest(matching);
  const delivery = channelEvidence(notificationLogs, type, since);
  const requiresMetaDelivery = type === 'sos' || type === 'fall';
  const metaChannels = (delivery?.channels || []).filter((channel) =>
    channel.channel === 'whatsapp' && channel.provider === 'meta' && !channel.skipped
  );
  const metaDelivered = metaChannels.length > 0 && metaChannels.every((channel) =>
    channel.deliveryStatus === 'delivered' || channel.deliveryStatus === 'read'
  );
  const dispatchCompleted = alert?.notifyStatus === 'sent' ||
    alert?.notifyStatus === 'delivered';
  const passed = requiresMetaDelivery ? metaDelivered : dispatchCompleted;

  let status = ACCEPTANCE_STATUS.PENDING;
  if (alert) status = passed ? ACCEPTANCE_STATUS.PASSED : ACCEPTANCE_STATUS.PARTIAL;

  let note;
  if (!alert) {
    note = `No ${type} event was recorded in this acceptance window.`;
  } else if (passed && requiresMetaDelivery) {
    note = 'The gateway persisted the device event and Meta confirmed WhatsApp delivery to every recorded recipient.';
  } else if (requiresMetaDelivery && metaChannels.length === 0) {
    note = 'The event exists, but no Meta WhatsApp delivery receipt is linked to it.';
  } else if (requiresMetaDelivery) {
    note = 'The event exists and Meta accepted the message, but handset delivery is not yet proven for every recipient.';
  } else {
    note = passed
      ? 'The event exists and configured notification dispatch completed.'
      : `The event exists, but notification status is ${alert.notifyStatus || 'unknown'}.`;
  }

  return {
    status,
    alert: summarizeAlert(alert),
    notificationEvidence: delivery,
    note,
  };
}

function geofenceCapability(alerts, since) {
  const enters = alerts.filter((alert) =>
    alert.type === 'geofence_enter' && after(alert, since)
  );
  const exits = alerts.filter((alert) =>
    alert.type === 'geofence_exit' && after(alert, since)
  );
  const enter = newest(enters);
  const exit = newest(exits);
  const delivered = [enter, exit].every((alert) => alert?.notifyStatus === 'sent');

  return {
    status: enter && exit && delivered
      ? ACCEPTANCE_STATUS.PASSED
      : ACCEPTANCE_STATUS.PENDING,
    enter: summarizeAlert(enter),
    exit: summarizeAlert(exit),
    note: enter && exit
      ? (delivered
          ? 'Both a real entry and exit were persisted and notification handling completed.'
          : 'Entry and exit exist, but at least one notification is incomplete.')
      : 'A real boundary crossing must produce both an entry and an exit in this window.',
  };
}

function reminderCapability(reminders, commands, since) {
  const reminder = newest(reminders.filter((value) => after(value, since)));
  const command = newest(commands.filter((value) =>
    value.type === 'set_medication_reminder' && after(value, since)
  ));
  const transportSent = command?.status === 'sent' && command?.result?.channel === 'tcp';
  const acknowledged = reminder?.acknowledgementStatus === 'acknowledged';

  let status = ACCEPTANCE_STATUS.PENDING;
  if (reminder && transportSent) status = ACCEPTANCE_STATUS.PARTIAL;
  if (reminder && transportSent && acknowledged) status = ACCEPTANCE_STATUS.PASSED;

  return {
    status,
    reminder: summarizeReminder(reminder),
    watchCommand: summarizeCommand(command),
    note: !reminder
      ? 'No canonical Care reminder was created in this acceptance window.'
      : !transportSent
        ? 'The reminder exists, but a TCP watch-command dispatch is not proven.'
        : !acknowledged
          ? 'The reminder and TCP dispatch are proven. Wearer/guardian acknowledgement is not yet proven end to end.'
          : 'Reminder creation, watch dispatch and acknowledgement are proven.',
  };
}

function locationCapability(device, since) {
  const satellite = device?.lastSatelliteLocation;
  const satelliteAt = asDate(satellite?.recordedAt);
  const valid = satellite?.gpsValid === true && satellite?.source === 'gps';
  const inWindow = Boolean(satelliteAt && satelliteAt >= since);
  return {
    status: valid && inWindow ? ACCEPTANCE_STATUS.PASSED : ACCEPTANCE_STATUS.PENDING,
    source: satellite?.source || null,
    gpsValid: satellite?.gpsValid === true,
    recordedAt: asIso(satellite?.recordedAt),
    accuracyMeters: satellite?.accuracyMeters ?? null,
    note: valid && inWindow
      ? 'A valid gps=A satellite fix was retained. This proves satellite validity, not a numerical metre-level accuracy.'
      : 'No valid satellite fix was retained in this acceptance window.',
  };
}

function wellbeingCapability(readings, since) {
  const matching = readings.filter((reading) => after(reading, since));
  const latestByMetric = {};
  for (const reading of matching) {
    const metric = String(reading.metricSet || 'unknown');
    const current = latestByMetric[metric];
    if (!current || (eventAt(reading)?.getTime() || 0) > (eventAt(current)?.getTime() || 0)) {
      latestByMetric[metric] = reading;
    }
  }
  const evidence = Object.values(latestByMetric).map((reading) => ({
    id: reading.id || null,
    metricSet: reading.metricSet || null,
    values: reading.values || {},
    quality: reading.quality || null,
    displayable: reading.displayable === true,
    observedAt: asIso(reading.observedAt || reading.receivedAt),
  }));
  return {
    releaseBlocking: false,
    status: evidence.length > 0
      ? ACCEPTANCE_STATUS.MANUAL_REQUIRED
      : ACCEPTANCE_STATUS.PENDING,
    protectedEvidencePresent: evidence.length > 0,
    readings: evidence,
    note: evidence.length === 0
      ? 'No consent-gated V52 wellbeing upload was captured in this acceptance window.'
      : 'Packet evidence exists. Compare each value with the watch display and repeat measurements before accepting the exact V52 firmware; no medical accuracy claim is made.',
  };
}

function buildDeviceAcceptanceReport(evidence, options = {}) {
  const now = asDate(options.now) || new Date();
  const since = asDate(options.since) || new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const device = evidence.device || {};
  const alerts = evidence.alerts || [];
  const commands = evidence.deviceCommands || [];
  const reminders = evidence.reminders || [];
  const notificationLogs = evidence.notificationLogs || [];
  const wellbeingReadings = evidence.wellbeingReadings || [];
  const heartbeat = asDate(device.lastHeartbeatAt);
  const heartbeatAgeMs = heartbeat ? now.getTime() - heartbeat.getTime() : null;
  const connectionPassed = device.online === true && heartbeatAgeMs != null &&
    heartbeatAgeMs >= 0 && heartbeatAgeMs <= DEFAULT_HEARTBEAT_FRESH_MS;

  const capabilities = {
    connection: {
      status: connectionPassed ? ACCEPTANCE_STATUS.PASSED : ACCEPTANCE_STATUS.PENDING,
      online: device.online === true,
      lastHeartbeatAt: asIso(heartbeat),
      heartbeatAgeSeconds: heartbeatAgeMs == null ? null : Math.round(heartbeatAgeMs / 1000),
      note: connectionPassed
        ? 'The watch has a fresh backend heartbeat.'
        : 'Start the gateway/tunnel and wait for a fresh watch heartbeat.',
    },
    location: locationCapability(device, since),
    sos: alertCapability('sos', alerts, notificationLogs, since),
    fall: alertCapability('fall', alerts, notificationLogs, since),
    geofence: geofenceCapability(alerts, since),
    battery: alertCapability('low_battery', alerts, notificationLogs, since),
    medicationReminder: reminderCapability(reminders, commands, since),
    careWellbeing: wellbeingCapability(wellbeingReadings, since),
    twoWayCall: {
      status: ACCEPTANCE_STATUS.MANUAL_REQUIRED,
      note: 'A normal carrier voice call bypasses Guardian servers. Record incoming and outgoing call results manually; backend logs cannot prove audio or carrier charging.',
    },
  };

  const machineObserved = Object.entries(capabilities)
    .filter(([, value]) =>
      value.releaseBlocking !== false &&
      value.status !== ACCEPTANCE_STATUS.MANUAL_REQUIRED
    );
  const machinePassed = machineObserved.every(([, value]) =>
    value.status === ACCEPTANCE_STATUS.PASSED
  );

  return {
    acceptanceWindow: {
      since: since.toISOString(),
      inspectedAt: now.toISOString(),
    },
    releaseReady: false,
    machineEvidenceComplete: machinePassed,
    releaseDecision: machinePassed
      ? 'Machine-observable evidence is complete, but manual call acceptance and the full release checklist are still required.'
      : 'Acceptance evidence is incomplete. Do not mark the advertised device promises Proven yet.',
    capabilities,
  };
}

module.exports = {
  ACCEPTANCE_STATUS,
  DEFAULT_HEARTBEAT_FRESH_MS,
  asDate,
  asIso,
  wellbeingCapability,
  buildDeviceAcceptanceReport,
};

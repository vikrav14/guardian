const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACCEPTANCE_STATUS,
  buildDeviceAcceptanceReport,
} = require('../src/device-acceptance');

const now = new Date('2026-08-15T10:00:00.000Z');
const since = new Date('2026-08-15T09:00:00.000Z');

function alert(id, type, minute, notifyStatus = 'sent') {
  return {
    id,
    type,
    severity: type === 'sos' ? 'critical' : 'warning',
    notifyStatus,
    eventAt: new Date(`2026-08-15T09:${minute}:00.000Z`),
  };
}

test('acceptance report never treats a carrier call as backend-proven', () => {
  const report = buildDeviceAcceptanceReport({}, { since, now });
  assert.equal(report.releaseReady, false);
  assert.equal(
    report.capabilities.twoWayCall.status,
    ACCEPTANCE_STATUS.MANUAL_REQUIRED
  );
  assert.match(report.capabilities.twoWayCall.note, /bypasses Guardian servers/);
});

test('real alert and notification statuses prove machine-observable safety paths', () => {
  const report = buildDeviceAcceptanceReport({
    device: {
      online: true,
      lastHeartbeatAt: new Date('2026-08-15T09:59:00.000Z'),
      lastSatelliteLocation: {
        source: 'gps', gpsValid: true, accuracyMeters: null,
        recordedAt: new Date('2026-08-15T09:10:00.000Z'),
      },
    },
    alerts: [
      alert('s1', 'sos', '15'),
      alert('f1', 'fall', '20'),
      alert('g1', 'geofence_exit', '25'),
      alert('g2', 'geofence_enter', '35'),
      alert('b1', 'low_battery', '40'),
    ],
    notificationLogs: [
      {
        alertType: 'sos', createdAt: new Date('2026-08-15T09:15:01.000Z'),
        contactCount: 1,
        results: [{ channels: { sms: { ok: true }, whatsapp: { skipped: true, reason: 'PLAN_EXCLUDES_WHATSAPP' } } }],
      },
    ],
    reminders: [{
      id: 'r1', imei: 'A', time: '10:00', frequency: 2, enabled: true,
      createdAt: new Date('2026-08-15T09:45:00.000Z'),
      acknowledgementStatus: 'acknowledged',
    }],
    deviceCommands: [{
      id: 'c1', type: 'set_medication_reminder', status: 'sent',
      result: { channel: 'tcp' },
      completedAt: new Date('2026-08-15T09:45:02.000Z'),
    }],
  }, { since, now });

  assert.equal(report.capabilities.connection.status, ACCEPTANCE_STATUS.PASSED);
  assert.equal(report.capabilities.location.status, ACCEPTANCE_STATUS.PASSED);
  assert.equal(report.capabilities.sos.status, ACCEPTANCE_STATUS.PASSED);
  assert.equal(report.capabilities.fall.status, ACCEPTANCE_STATUS.PASSED);
  assert.equal(report.capabilities.geofence.status, ACCEPTANCE_STATUS.PASSED);
  assert.equal(report.capabilities.battery.status, ACCEPTANCE_STATUS.PASSED);
  assert.equal(report.capabilities.medicationReminder.status, ACCEPTANCE_STATUS.PASSED);
  assert.equal(report.machineEvidenceComplete, true);
  assert.equal(report.releaseReady, false);
  assert.equal(report.capabilities.sos.notificationEvidence.channels[1].reason, 'PLAN_EXCLUDES_WHATSAPP');
});

test('a sent reminder command is only transport proof until acknowledgement exists', () => {
  const report = buildDeviceAcceptanceReport({
    reminders: [{ id: 'r1', enabled: true, createdAt: now }],
    deviceCommands: [{
      id: 'c1', type: 'set_medication_reminder', status: 'sent',
      result: { channel: 'tcp' }, completedAt: now,
    }],
  }, { since, now });

  assert.equal(report.capabilities.medicationReminder.status, ACCEPTANCE_STATUS.PARTIAL);
  assert.match(report.capabilities.medicationReminder.note, /acknowledgement is not yet proven/);
});

test('geofence requires both transition directions and completed notification handling', () => {
  const report = buildDeviceAcceptanceReport({
    alerts: [alert('g1', 'geofence_exit', '25')],
  }, { since, now });
  assert.equal(report.capabilities.geofence.status, ACCEPTANCE_STATUS.PENDING);
  assert.equal(report.capabilities.geofence.enter, null);
  assert.equal(report.capabilities.geofence.exit.id, 'g1');
});

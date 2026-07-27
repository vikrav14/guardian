import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/alert_formatters.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/models/device.dart';

void main() {
  test('alertDisplayTitle prefers stored title and person name for offline', () {
    const alert = GuardianAlert(
      id: '1',
      imei: '861397053141170',
      type: 'offline',
      severity: 'warning',
      message: 'technical',
      resolved: false,
      title: 'Bouboush has not checked in',
    );
    const device = Device(imei: '861397053141170', online: false, nickname: 'Bouboush');

    expect(alertDisplayTitle(alert, device: device), 'Bouboush has not checked in');
  });

  test('alertDisplayBody humanizes legacy heartbeat alerts', () {
    const alert = GuardianAlert(
      id: '1',
      imei: '861397053141170',
      type: 'offline',
      severity: 'warning',
      message:
          'No heartbeat for 35 minutes (last at 2026-07-23T16:05:25.836Z). Device may be unreachable.',
      resolved: false,
    );

    final body = alertDisplayBody(alert);
    expect(body, contains('35 minutes'));
    expect(body, isNot(contains('2026-07-23T')));
    expect(body, isNot(contains('heartbeat')));
  });

  test('alertDisplaySubtitle uses person name instead of IMEI', () {
    const alert = GuardianAlert(
      id: '1',
      imei: '861397053141170',
      type: 'offline',
      severity: 'warning',
      message: 'message',
      resolved: false,
      createdAt: null,
    );
    const device = Device(
      imei: '861397053141170',
      online: false,
      nickname: 'Bouboush',
    );

    expect(alertDisplaySubtitle(alert, device: device), 'Bouboush · —');
  });
}

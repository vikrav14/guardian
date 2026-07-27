import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/device_connectivity.dart';
import 'package:guardian/models/device.dart';

void main() {
  final now = DateTime.utc(2026, 7, 23, 18, 0);

  test('stale online flag without recent contact is not live', () {
    final device = Device(
      imei: '1',
      online: true,
      lastHeartbeatAt: now.subtract(const Duration(minutes: 15)),
    );

    expect(device.isLiveConnected, isFalse);
    expect(device.connectivityPhase(now: now), DeviceConnectivityPhase.offline);
  });

  test('powered off device shows offline not linking up', () {
    final device = Device(
      imei: '1',
      online: false,
      nickname: 'Bouboush',
      connectionState: 'offline',
      disconnectedAt: now.subtract(const Duration(minutes: 2)),
    );

    expect(device.connectivityPhase(now: now), DeviceConnectivityPhase.offline);
    expect(deviceConnectivityLabel(device, now: now), 'Offline');
  });

  test('gateway handshake shows linking up', () {
    final device = Device(
      imei: '1',
      online: false,
      nickname: 'Bouboush',
      connectionState: 'connecting',
      connectingAt: now.subtract(const Duration(seconds: 20)),
    );

    expect(device.connectivityPhase(now: now), DeviceConnectivityPhase.reconnecting);
    expect(deviceConnectivityLabel(device, now: now), 'Linking up');
  });

  test('handshake wins over stale online flag during reconnect', () {
    final device = Device(
      imei: '1',
      online: true,
      lastHeartbeatAt: DateTime.now(),
      connectionState: 'connecting',
      connectingAt: DateTime.now().subtract(const Duration(seconds: 5)),
    );

    expect(device.connectivityPhase(), DeviceConnectivityPhase.reconnecting);
  });

  test('expired handshake falls back to offline', () {
    final device = Device(
      imei: '1',
      online: false,
      connectionState: 'connecting',
      connectingAt: now.subtract(const Duration(minutes: 5)),
    );

    expect(device.connectivityPhase(now: now), DeviceConnectivityPhase.offline);
  });

  test('dashboard safety mood uses offline title when pendant is off', () {
    final devices = [
      Device(
        imei: '1',
        online: false,
        nickname: 'Bouboush',
        connectionState: 'offline',
        disconnectedAt: now.subtract(const Duration(minutes: 6)),
      ),
    ];

    expect(dashboardSafetyMood(devices, now: now), DashboardSafetyMood.allOffline);
    expect(dashboardSafetyTitle(devices, now: now), 'Bouboush is offline');
  });

  test('dashboard safety mood shows linking only during handshake', () {
    final devices = [
      Device(
        imei: '1',
        online: false,
        nickname: 'Bouboush',
        connectionState: 'connecting',
        connectingAt: now.subtract(const Duration(seconds: 10)),
      ),
    ];

    expect(dashboardSafetyMood(devices, now: now), DashboardSafetyMood.linkingUp);
    expect(
      dashboardSafetyTitle(devices, now: now),
      'Linking up with Bouboush…',
    );
  });

  test('stale live snapshot after offline shows linking until session heartbeat', () {
    final clock = DateTime.now();
    final disconnectedAt = clock.subtract(const Duration(seconds: 30));

    final staleLive = Device(
      imei: '1',
      online: true,
      connectionState: 'live',
      lastHeartbeatAt: disconnectedAt.subtract(const Duration(minutes: 1)),
      disconnectedAt: disconnectedAt,
    );

    expect(staleLive.connectivityPhase(now: clock), DeviceConnectivityPhase.reconnecting);
  });

  test('power-on sequence is offline then linking then live', () {
    final clock = DateTime.now();
    final connectingAt = clock;

    final offline = Device(
      imei: '1',
      online: false,
      connectionState: 'offline',
      disconnectedAt: connectingAt.subtract(const Duration(minutes: 1)),
    );
    expect(offline.connectivityPhase(now: clock), DeviceConnectivityPhase.offline);

    final connecting = Device(
      imei: '1',
      online: false,
      connectionState: 'connecting',
      connectingAt: connectingAt,
      disconnectedAt: offline.disconnectedAt,
    );
    expect(
      connecting.connectivityPhase(now: clock.add(const Duration(seconds: 1))),
      DeviceConnectivityPhase.reconnecting,
    );

    final stillLinking = Device(
      imei: '1',
      online: false,
      connectionState: 'connecting',
      connectingAt: connectingAt,
      lastHeartbeatAt: clock.add(const Duration(seconds: 1)),
      disconnectedAt: offline.disconnectedAt,
    );
    expect(
      stillLinking.connectivityPhase(now: clock.add(const Duration(seconds: 2))),
      DeviceConnectivityPhase.reconnecting,
    );

    final live = Device(
      imei: '1',
      online: true,
      connectionState: 'live',
      connectingAt: connectingAt,
      lastHeartbeatAt: clock.add(const Duration(seconds: 2)),
      disconnectedAt: offline.disconnectedAt,
    );
    expect(
      live.connectivityPhase(now: clock.add(const Duration(seconds: 2))),
      DeviceConnectivityPhase.live,
    );
  });

  test('transient offline with recent heartbeat stays linking not offline', () {
    final now = DateTime.now();
    final device = Device(
      imei: '1',
      online: false,
      connectionState: 'offline',
      lastHeartbeatAt: now.subtract(const Duration(seconds: 30)),
      disconnectedAt: now.subtract(const Duration(seconds: 20)),
    );

    expect(device.connectivityPhase(now: now), DeviceConnectivityPhase.reconnecting);
  });

  test('brief offline write during power-on stays linking', () {
    final connectingAt = now.subtract(const Duration(seconds: 45));
    final device = Device(
      imei: '1',
      online: false,
      connectionState: 'offline',
      connectingAt: connectingAt,
      disconnectedAt: connectingAt.subtract(const Duration(seconds: 2)),
    );

    expect(device.connectivityPhase(now: now), DeviceConnectivityPhase.reconnecting);
    expect(dashboardSafetyTitle([device], now: now), contains('Linking up'));
  });

  test('powered off after linking grace shows offline not linking', () {
    final device = Device(
      imei: '1',
      online: false,
      connectionState: 'offline',
      connectingAt: now.subtract(const Duration(minutes: 5)),
      disconnectedAt: now.subtract(const Duration(minutes: 2)),
    );

    expect(device.connectivityPhase(now: now), DeviceConnectivityPhase.offline);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/dashboard_insight.dart';
import 'package:guardian/dashboard/linking_story.dart';
import 'package:guardian/dashboard/dashboard_status_colors.dart';
import 'package:guardian/dashboard/device_card_visibility.dart';
import 'package:guardian/dashboard/device_formatters.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/dashboard/smart_device_map_card.dart';

void main() {
  test('Guardian insight shows linking copy during gateway handshake', () {
    final now = DateTime.now();
    final device = Device(
      imei: '1',
      online: false,
      nickname: 'Bouboush',
      connectionState: 'connecting',
      connectingAt: now,
    );

    final insight = linkingGuardianInsight(device, now: now, tick: 0);
    expect(insight.title, contains('Bouboush'));
    expect(insight.detail, isNotEmpty);
    expect(insight.tone, DashboardInsightTone.neutral);
  });

  test('Guardian insight prioritizes offline and low-battery states', () {
    const offline = Device(imei: '1', online: false, batteryPercent: 10);
    const lowBattery = Device(imei: '2', online: true, batteryPercent: 10);

    expect(
      buildDashboardInsight(offline).tone,
      DashboardInsightTone.danger,
    );
    expect(
      buildDashboardInsight(lowBattery).tone,
      DashboardInsightTone.warning,
    );
  });

  test('Guardian insight uses gateway intelligence when present', () {
    final now = DateTime(2026, 7, 22, 13, 40);
    final device = Device(
      imei: '1',
      online: true,
      batteryPercent: 70,
      location: DeviceLocation(lat: -20.2, lng: 57.5, recordedAt: now),
      lastHeartbeatAt: now,
      intelligence: DeviceIntelligence(
        insights: const [
          DeviceIntelligenceInsight(
            id: 'stale_gps',
            inference: 'Last GPS fix is 12 minutes old.',
            confidence: 80,
            level: 'warning',
          ),
        ],
        topInsight: const DeviceIntelligenceInsight(
          id: 'stale_gps',
          inference: 'Last GPS fix is 12 minutes old.',
          confidence: 80,
          level: 'warning',
        ),
      ),
    );

    final insight = buildDashboardInsight(device);
    expect(insight.title, 'Location may be outdated');
    expect(insight.tone, DashboardInsightTone.warning);
  });

  test('offline insight explains last known location age', () {
    final heartbeat = DateTime.now().subtract(const Duration(minutes: 40));
    final recorded = heartbeat.subtract(const Duration(minutes: 2));
    final device = Device(
      imei: '1',
      online: false,
      accuracySource: 'wifi',
      lastHeartbeatAt: heartbeat,
      location: DeviceLocation(
        lat: -20.2,
        lng: 57.5,
        recordedAt: recorded,
      ),
    );

    final insight = buildDashboardInsight(device);
    expect(insight.title, 'Last known location may be outdated');
    expect(insight.detail, contains('Last seen'));
    expect(insight.detail, contains('approximate'));
  });

  test('device location status label distinguishes offline last known fix', () {
    const offline = Device(imei: '1', online: false);
    final offlineWithFix = Device(
      imei: '2',
      online: false,
      location: DeviceLocation(lat: -20.2, lng: 57.5),
    );

    expect(deviceLocationStatusLabel(offline), 'Location unavailable');
    expect(deviceLocationStatusLabel(offlineWithFix), 'Last known location');
  });

  test('Guardian insight reports normal only with live GPS', () {
    final now = DateTime.now();
    final device = Device(
      imei: '1',
      online: true,
      connectionState: 'live',
      batteryPercent: 70,
      location: DeviceLocation(lat: -20.2, lng: 57.5, recordedAt: now),
      lastHeartbeatAt: now,
    );

    expect(buildDashboardInsight(device).tone, DashboardInsightTone.safe);
  });

  test('Guardian insight waits when GPS coordinates are stale', () {
    final heartbeat = DateTime.now();
    final device = Device(
      imei: '1',
      online: true,
      connectionState: 'live',
      batteryPercent: 70,
      lastHeartbeatAt: heartbeat,
      location: DeviceLocation(
        lat: -20.261286,
        lng: 57.477801,
        recordedAt: heartbeat.subtract(const Duration(minutes: 10)),
      ),
    );

    expect(buildDashboardInsight(device).tone, DashboardInsightTone.warning);
  });

  test('device update label uses the newest available timestamp', () {
    final now = DateTime(2026, 7, 21, 20);
    final device = Device(
      imei: '1',
      online: true,
      updatedAt: now.subtract(const Duration(minutes: 4)),
    );

    expect(deviceUpdatedLabel(device, now: now), 'Updated 4m ago');
  });

  test('device movement label ignores stale speed from old simulator data', () {
    final heartbeat = DateTime.now();
    final staleRecorded = heartbeat.subtract(const Duration(minutes: 11));
    final device = Device(
      imei: '1',
      online: true,
      connectionState: 'live',
      speedKmh: 45,
      lastHeartbeatAt: heartbeat,
      location: DeviceLocation(
        lat: -20.261286,
        lng: 57.477801,
        recordedAt: staleRecorded,
      ),
    );

    expect(deviceMovementLabel(device), 'Stationary');
    expect(device.isMoving, isFalse);
  });

  test('device movement label uses reconnecting state during handshake', () {
    final now = DateTime.now();
    final reconnecting = Device(
      imei: '1',
      online: false,
      connectionState: 'connecting',
      connectingAt: now.subtract(const Duration(seconds: 30)),
    );

    expect(deviceMovementLabel(reconnecting), 'Linking up');
  });

  test('device movement label shows offline when pendant is off', () {
    final device = Device(
      imei: '1',
      online: false,
      connectionState: 'offline',
      disconnectedAt: DateTime.now().subtract(const Duration(minutes: 2)),
    );

    expect(deviceMovementLabel(device), 'Not connected');
  });

  test('device movement label uses speed threshold, not online flag', () {
    final now = DateTime.now();
    final freshLocation = DeviceLocation(
      lat: -20.2,
      lng: 57.5,
      recordedAt: now,
    );
    const offline = Device(imei: '1', online: false, speedKmh: 45);
    final stationary = Device(
      imei: '2',
      online: true,
      connectionState: 'live',
      speedKmh: 0,
      location: freshLocation,
      lastHeartbeatAt: now,
    );
    final moving = Device(
      imei: '3',
      online: true,
      connectionState: 'live',
      speedKmh: 12,
      location: freshLocation,
      lastHeartbeatAt: now,
    );
    final staleSpeed = Device(
      imei: '4',
      online: true,
      connectionState: 'live',
      speedKmh: 45,
      location: DeviceLocation(
        lat: -20.2,
        lng: 57.5,
        recordedAt: now.subtract(const Duration(minutes: 15)),
      ),
      lastHeartbeatAt: now,
    );

    expect(deviceMovementLabel(offline), 'Not connected');
    expect(deviceMovementLabel(stationary), 'Stationary');
    expect(deviceMovementLabel(moving), 'Moving');
    expect(deviceMovementLabel(staleSpeed), 'Stationary');
    expect(stationary.isMoving, isFalse);
    expect(moving.isMoving, isTrue);
    expect(staleSpeed.isMoving, isFalse);
  });

  test('flag metric colors use vivid palette when active', () {
    final online = flagMetricColors(DashboardFlagMetric.connectivity, true);
    final gps = flagMetricColors(DashboardFlagMetric.gps, true);
    final battery = flagMetricColors(DashboardFlagMetric.battery, true);
    final signal = flagMetricColors(DashboardFlagMetric.signal, true);

    expect(online.foreground, GuardianColors.flagRed);
    expect(gps.foreground, GuardianColors.flagBlue);
    expect(battery.foreground, GuardianColors.flagYellow);
    expect(signal.foreground, GuardianColors.flagGreen);
  });

  test('flag metric colors use muted palette when inactive', () {
    final offline = flagMetricColors(DashboardFlagMetric.connectivity, false);
    final waiting = flagMetricColors(DashboardFlagMetric.gps, false);
    final lowBattery = flagMetricColors(DashboardFlagMetric.battery, false);
    final noSignal = flagMetricColors(DashboardFlagMetric.signal, false);

    expect(offline.foreground, GuardianColors.flagRedMuted);
    expect(waiting.foreground, GuardianColors.flagBlueMuted);
    expect(lowBattery.foreground, GuardianColors.flagYellowMuted);
    expect(noSignal.foreground, GuardianColors.flagGreenMuted);
  });

  test('battery health threshold treats null and low values as unhealthy', () {
    expect(dashboardBatteryHealthy(null), isFalse);
    expect(dashboardBatteryHealthy(20), isFalse);
    expect(dashboardBatteryHealthy(21), isTrue);
  });

  test('map card attention flags offline, low battery, and open alerts', () {
    final now = DateTime.now();
    final healthy = Device(
      imei: '1',
      online: true,
      connectionState: 'live',
      batteryPercent: 70,
      location: DeviceLocation(lat: -20.2, lng: 57.5, recordedAt: now),
      lastHeartbeatAt: now,
    );
    const offline = Device(imei: '2', online: false, batteryPercent: 70);
    const lowBattery = Device(imei: '3', online: true, batteryPercent: 15);
    const sosAlert = GuardianAlert(
      id: 'a1',
      imei: '1',
      type: 'sos',
      severity: 'critical',
      message: 'SOS',
      resolved: false,
    );

    expect(deviceNeedsMapCardAttention(healthy), isFalse);
    expect(deviceMapCardStatusNormal(healthy), isTrue);
    expect(deviceNeedsMapCardAttention(offline), isTrue);
    expect(deviceNeedsMapCardAttention(lowBattery), isTrue);
    expect(
      deviceNeedsMapCardAttention(healthy, alerts: const [sosAlert]),
      isTrue,
    );
  });

  testWidgets('smart device map card minimizes and expands', (tester) async {
    final now = DateTime.now();
    final device = Device(
      imei: '1',
      nickname: 'Bouboush',
      relationship: 'Wife',
      online: true,
      connectionState: 'live',
      batteryPercent: 52,
      location: DeviceLocation(lat: -20.2, lng: 57.5, recordedAt: now),
      lastHeartbeatAt: now,
    );
    var minimized = false;

    await tester.pumpWidget(
      MaterialApp(
        theme: buildGuardianTheme(),
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) {
              return SmartDeviceMapCard(
                device: device,
                updated: 'Updated 1m ago',
                onOpen: () {},
                minimized: minimized,
                onMinimize: () => setState(() => minimized = true),
                onExpand: () => setState(() => minimized = false),
              );
            },
          ),
        ),
      ),
    );

    expect(find.byKey(const ValueKey('smart-device-map-card')), findsOneWidget);
    expect(find.text('View details'), findsOneWidget);
    expect(find.text('All good — hide when you do not need this'), findsOneWidget);

    await tester.tap(find.byTooltip('Minimize'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('smart-device-map-chip')), findsOneWidget);
    expect(find.text('View details'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('smart-device-map-chip')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('smart-device-map-card')), findsOneWidget);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/dashboard_insight.dart';
import 'package:guardian/dashboard/dashboard_status_colors.dart';
import 'package:guardian/dashboard/device_formatters.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/dashboard/desktop_dashboard_layout.dart';

void main() {
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

  test('Guardian insight reports normal only with live GPS', () {
    final now = DateTime(2026, 7, 22, 13, 40);
    final device = Device(
      imei: '1',
      online: true,
      batteryPercent: 70,
      location: DeviceLocation(lat: -20.2, lng: 57.5, recordedAt: now),
      lastHeartbeatAt: now,
    );

    expect(buildDashboardInsight(device).tone, DashboardInsightTone.safe);
  });

  test('Guardian insight waits when GPS coordinates are stale', () {
    final heartbeat = DateTime.utc(2026, 7, 22, 13, 40);
    final device = Device(
      imei: '1',
      online: true,
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
    final heartbeat = DateTime.utc(2026, 7, 22, 13, 40);
    final staleRecorded = heartbeat.subtract(const Duration(minutes: 11));
    final device = Device(
      imei: '1',
      online: true,
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

  test('device movement label uses speed threshold, not online flag', () {
    final now = DateTime(2026, 7, 22, 13, 40);
    final freshLocation = DeviceLocation(
      lat: -20.2,
      lng: 57.5,
      recordedAt: now,
    );
    const offline = Device(imei: '1', online: false, speedKmh: 45);
    final stationary = Device(
      imei: '2',
      online: true,
      speedKmh: 0,
      location: freshLocation,
      lastHeartbeatAt: now,
    );
    final moving = Device(
      imei: '3',
      online: true,
      speedKmh: 12,
      location: freshLocation,
      lastHeartbeatAt: now,
    );
    final staleSpeed = Device(
      imei: '4',
      online: true,
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

  testWidgets('desktop person card leaves map controls clickable', (
    tester,
  ) async {
    var mapTapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Center(
          child: SizedBox(
            key: const ValueKey('map-panel'),
            width: 800,
            height: 360,
            child: Stack(
              children: [
                Positioned.fill(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => mapTapped = true,
                  ),
                ),
                const DesktopMapPersonCardPlacement(
                  child: SizedBox(
                    key: ValueKey('person-card'),
                    height: 180,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    final mapRect = tester.getRect(find.byKey(const ValueKey('map-panel')));
    final cardRect = tester.getRect(find.byKey(const ValueKey('person-card')));

    expect(
      cardRect.left,
      mapRect.left + DesktopMapPersonCardPlacement.leftInset,
    );
    expect(cardRect.right, lessThan(mapRect.right - 72));

    await tester.tapAt(Offset(mapRect.right - 24, mapRect.bottom - 24));
    expect(mapTapped, isTrue);
  });
}

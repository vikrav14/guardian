import 'dart:convert';
import 'dart:io';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/dashboard_ai_interpretation.dart';
import 'package:guardian/dashboard/dashboard_controller.dart';
import 'package:guardian/dashboard/device_formatters.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/home_wifi_presence.dart';
import 'package:guardian/services/guardian_services.dart';

void main() {
  final fixtures = jsonDecode(
    File('../../docs/testing/wifi-home-display.json').readAsStringSync(),
  ) as List<dynamic>;

  DeviceLocation? location(dynamic raw) => raw is Map
      ? DeviceLocation.fromMap(Map<String, dynamic>.from(raw))
      : null;

  for (final raw in fixtures) {
    final fixture = Map<String, dynamic>.from(raw as Map);
    test('app/chat Home contract: ${fixture['name']}', () {
      final evidence = Map<String, dynamic>.from(fixture['device'] as Map);
      final homeMap = evidence['homeWifiPresence'];
      final gps = location(evidence['lastSatelliteLocation']);
      final network = location(evidence['location']);
      final device = Device(
        imei: 'fixture-watch', online: true,
        accuracySource: evidence['accuracySource'] as String?,
        location: network,
        lastLocationObservation: location(evidence['lastLocationObservation']),
        lastSatelliteLocation: gps,
        homeWifiPresence: HomeWifiPresence.fromMap(
          homeMap is Map ? Map<String, dynamic>.from(homeMap) : null,
        ),
      );
      final now = DateTime.parse(fixture['now'] as String);
      final expectedHome = fixture['expectedHome'] == true;
      expect(device.homeWifiLocationAt(now) != null, expectedHome);
      final pin = device.mapDisplayLocationAt(now)!;
      if (expectedHome) {
        final anchor = (homeMap as Map)['anchor'] as Map;
        expect(pin.lat, anchor['lat']);
        expect(pin.lng, anchor['lng']);
        expect(pin.source, 'home_wifi');
        expect(pin.gpsValid, false);
        expect(pin.accuracyMeters, isNull);
        expect(deviceMapLocationFixLabel(device, now: now), contains('Home Wi-Fi detected'));
      } else {
        expect(pin.lat, (gps ?? network)!.lat);
        expect(pin.source, (gps ?? network)!.source);
      }
      expect(device.location, same(network));
      expect(device.lastSatelliteLocation, same(gps));
    });
  }

  test('Firestore reader keeps Home, GPS and heartbeat times separate across dashboard labels', () async {
    final now = DateTime.now().toUtc();
    final db = FakeFirebaseFirestore();
    final data = Map<String, dynamic>.from((fixtures.first as Map)['device'] as Map);
    final home = Map<String, dynamic>.from(data['homeWifiPresence'] as Map);
    home['observedAt'] = now.subtract(const Duration(seconds: 10)).toIso8601String();
    home['expiresAt'] = now.add(const Duration(seconds: 50)).toIso8601String();
    data['homeWifiPresence'] = home;
    data['lastHeartbeatAt'] = now;
    data['connectionState'] = 'live';
    await db.collection('devices').doc('fixture-watch').set(data);
    final device = Device.fromDoc(await db.collection('devices').doc('fixture-watch').get());
    expect(device.mapDisplayLocation!.source, 'home_wifi');
    expect(deviceGpsChipLabel(device), 'Home Wi-Fi');
    expect(deviceMapLocationStatusLabel(device), 'Home Wi-Fi detected');
    expect(deviceHomeWifiFixLabel(device), 'Home Wi-Fi detected just now');
    expect(buildGuardianAiInterpretation(device), contains('at or near your saved Home location'));
    expect(buildGuardianAiInterpretation(device), contains('Last GPS fix'));
    expect(device.lastHeartbeatAt, now);
    expect(device.displayLocationSource, 'gps');
    expect(device.lastSatelliteLocation!.recordedAt, DateTime.parse('2026-09-01T10:00:00Z'));
  });

  testWidgets('dashboard removes expired Home evidence without a new Firestore event', (tester) async {
    final db = FakeFirebaseFirestore();
    final auth = MockFirebaseAuth(signedIn: false);
    var now = DateTime.utc(2026, 9, 1, 12);
    final controller = DashboardController(
      deviceService: DeviceService(db: db, auth: auth),
      geofenceService: GeofenceService(db: db, auth: auth),
      now: () => now,
    );
    controller.start();
    await tester.pump();
    final gps = DeviceLocation(lat: -20.1, lng: 57.1, source: 'gps',
      recordedAt: now.subtract(const Duration(hours: 1)), gpsValid: true);
    controller.devices = [Device(imei: 'fixture-watch', online: true,
      lastSatelliteLocation: gps,
      homeWifiPresence: HomeWifiPresence(lat: -20.15, lng: 57.15,
        observedAt: now, expiresAt: now.add(const Duration(seconds: 30))))];
    var changes = 0;
    controller.addListener(() => changes++);
    await tester.pump(const Duration(seconds: 1));
    expect(changes, 1);
    expect(controller.selected!.mapDisplayLocationAt(now)!.source, 'home_wifi');
    await tester.pump(const Duration(seconds: 5));
    expect(changes, 1, reason: 'No camera refresh on each heartbeat/timer tick');
    now = now.add(const Duration(seconds: 30));
    await tester.pump(const Duration(seconds: 1));
    expect(changes, 2);
    expect(controller.selected!.mapDisplayLocationAt(now), same(gps));
    controller.dispose();
    await tester.pump(const Duration(seconds: 1));
  });
}

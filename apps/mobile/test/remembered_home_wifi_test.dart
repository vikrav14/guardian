import 'dart:convert';
import 'dart:io';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/dashboard_controller.dart';
import 'package:guardian/dashboard/dashboard_ai_interpretation.dart';
import 'package:guardian/dashboard/device_formatters.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/services/guardian_services.dart';

void main() {
  final fixtures =
      jsonDecode(
            File(
              '../../docs/testing/wifi-home-remembered.json',
            ).readAsStringSync(),
          )
          as List;
  for (final raw in fixtures) {
    final fixture = Map<String, dynamic>.from(raw as Map);
    test('remembered Home app/chat contract: ${fixture['name']}', () async {
      final db = FakeFirebaseFirestore();
      final data = Map<String, dynamic>.from(fixture['device'] as Map);
      await db.collection('devices').doc('synthetic-watch').set(data);
      final device = Device.fromDoc(
        await db.collection('devices').doc('synthetic-watch').get(),
      );
      final now = DateTime.parse(fixture['now'] as String);
      final remembered = device.rememberedHomeWifiLocationAt(now);
      expect(remembered != null, fixture['expectedRemembered']);
      final pin = device.mapDisplayLocationAt(now);
      if (fixture['expectedRemembered'] == true) {
        final record = data['lastHomeWifiDetection'] as Map;
        expect(pin!.lat, (record['anchor'] as Map)['lat']);
        expect(pin.source, 'home_wifi_last_detected');
        expect(pin.recordedAt, DateTime.parse(record['observedAt'] as String));
        expect(pin.gpsValid, false);
        expect(device.homeWifiLocationAt(now), isNull);
        expect(
          deviceMapLocationFixLabel(device, now: now),
          contains('Last detected at Home'),
        );
      } else {
        await db.collection('devices').doc('fallback').set({
          ...data,
          'lastHomeWifiDetection': null,
        });
        final fallback = Device.fromDoc(
          await db.collection('devices').doc('fallback').get(),
        ).mapDisplayLocationAt(now);
        expect(pin?.lat, fallback?.lat);
        expect(pin?.lng, fallback?.lng);
        expect(pin?.source, fallback?.source);
      }
    });
  }

  testWidgets(
    'a quiet Firestore stream changes fresh Home into aged Home and advances the displayed age',
    (tester) async {
      var now = DateTime.now();
      final start = now;
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'synthetic-owner'),
        signedIn: true,
      );
      await db.collection('users').doc('synthetic-owner').set({
        'linkedImeis': ['synthetic-watch'],
      });
      final fixture = Map<String, dynamic>.from(
        fixtures.first['device'] as Map,
      );
      final record = Map<String, dynamic>.from(
        fixture['lastHomeWifiDetection'] as Map,
      );
      record['observedAt'] = start.toIso8601String();
      record['qualifiedUntil'] = start
          .add(const Duration(minutes: 2))
          .toIso8601String();
      final home = {
        'version': 4,
        'policy': 'enrolled_home_radio_v4',
        'pilot': true,
        'state': 'matched',
        'source': 'home_wifi',
        'anchor': record['anchor'],
        'observedAt': record['observedAt'],
        'expiresAt': record['qualifiedUntil'],
      };
      await db.collection('devices').doc('synthetic-watch').set({
        'online': true,
        'lastHeartbeatAt': start,
        'homeWifiPresence': home,
        'lastHomeWifiDetection': record,
      });
      final controller = DashboardController(
        now: () => now,
        deviceService: DeviceService(db: db, auth: auth),
        geofenceService: GeofenceService(db: db, auth: auth),
      );
      try {
        var changes = 0;
        controller.addListener(() => changes++);
        controller.start();
        await tester.pump();
        await tester.pump();
        expect(controller.selected!.homeWifiLocationAt(now), isNotNull);
        final initial = changes;
        now = start.add(const Duration(minutes: 3));
        await tester.pump(const Duration(seconds: 1));
        expect(changes, greaterThan(initial));
        expect(controller.selected!.homeWifiLocationAt(now), isNull);
        expect(
          controller.selected!.rememberedHomeWifiLocationAt(now),
          isNotNull,
        );
        expect(
          deviceMapLocationFixLabel(controller.selected!, now: now),
          'Last detected at Home 3m ago',
        );
        final aged = changes;
        now = start.add(const Duration(minutes: 4));
        await tester.pump(const Duration(seconds: 1));
        expect(changes, greaterThan(aged));
        expect(
          deviceMapLocationFixLabel(controller.selected!, now: now),
          'Last detected at Home 4m ago',
        );
      } finally {
        controller.dispose();
      }
    },
  );

  test(
    'historical interpretation does not imply the wearer is currently at Home',
    () async {
      final db = FakeFirebaseFirestore();
      final at = DateTime.now().subtract(const Duration(minutes: 10));
      final data = Map<String, dynamic>.from(fixtures.first['device'] as Map);
      final history = Map<String, dynamic>.from(
        data['lastHomeWifiDetection'] as Map,
      );
      history['observedAt'] = at.toIso8601String();
      history['qualifiedUntil'] = at
          .add(const Duration(minutes: 2))
          .toIso8601String();
      await db.collection('devices').doc('synthetic-watch').set({
        'lastHomeWifiDetection': history,
        'online': false,
      });
      final device = Device.fromDoc(
        await db.collection('devices').doc('synthetic-watch').get(),
      );
      expect(
        buildGuardianAiInterpretation(device),
        contains('Current presence at Home is unconfirmed'),
      );
      expect(deviceLocationStatusLabel(device), 'Last detected at Home');
    },
  );
}

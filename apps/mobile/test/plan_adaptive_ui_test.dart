import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/screens/journey_page.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/widgets/dashboard/around_them_panel.dart';
import 'package:guardian/widgets/dashboard/guardian_now_hero.dart';

void main() {
  const device = Device(
    imei: '861397052547492',
    online: true,
    nickname: 'Jesh',
    batteryPercent: 70,
    careProfile: 'senior',
  );

  testWidgets('Essential dashboard uses factual status and locks WhatsApp', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GuardianNowHero(
            device: device,
            aiInterpretation: 'AI interpretation',
            guardianAiEnabled: false,
            askGuardianEnabled: false,
            onAskGuardian: _noop,
          ),
        ),
      ),
    );

    expect(find.text('Watch status'), findsOneWidget);
    expect(find.text('Guardian AI'), findsNothing);
    expect(find.text('Family plan required'), findsOneWidget);
  });

  testWidgets('Family dashboard exposes Guardian AI and hybrid help', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GuardianNowHero(
            device: device,
            aiInterpretation: 'AI interpretation',
            guardianAiEnabled: true,
            askGuardianEnabled: true,
            onAskGuardian: _noop,
          ),
        ),
      ),
    );

    expect(find.text('Guardian AI'), findsOneWidget);
    expect(find.text('Guardian help'), findsOneWidget);
    expect(find.text('Quick checks & WhatsApp'), findsOneWidget);
    expect(find.text('Family plan required'), findsNothing);
  });

  testWidgets('Care cards never leak into Family or Essential', (tester) async {
    Future<void> pump({required bool care}) {
      return tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AroundThemPanel(
              device: device,
              geofences: const [],
              guardianIntelligence: 'All calm',
              guardianAiEnabled: true,
              careEnabled: care,
              medicationEnabled: care,
            ),
          ),
        ),
      );
    }

    await pump(care: false);
    expect(find.text('Wellbeing'), findsNothing);
    expect(find.text('Medication'), findsNothing);

    await pump(care: true);
    expect(find.text('Wellbeing'), findsOneWidget);
    expect(find.text('Medication'), findsOneWidget);
  });

  testWidgets('pushed journey route does not depend on a home-only scope', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: JourneyPage(
          imei: '861397052547492',
          deviceName: 'Jesh',
          subscription: GuardianSubscription.inactive(),
        ),
      ),
    );

    expect(find.text('Guardian service inactive'), findsOneWidget);
    expect(find.text('Go back'), findsOneWidget);
  });

  test('journey origin resolves the configured zone by its durable id', () {
    final start = DateTime(2026, 8, 21, 12);
    final journey = JourneyRecord(
      id: 'trip-1',
      startAt: start,
      endAt: start.add(const Duration(minutes: 20)),
      polyline: 'encoded',
      distanceKm: 2,
      pointCount: 2,
      closeReason: 'return_to_origin',
      originGeofenceId: 'home-id',
      originGeofenceName: 'Home',
    );
    const office = Geofence(
      id: 'office-id',
      imei: 'watch-1',
      name: 'Home',
      active: true,
      lat: -20.1,
      lng: 57.5,
      radiusMeters: 100,
    );
    const home = Geofence(
      id: 'home-id',
      imei: 'watch-1',
      name: 'Lower Vale home',
      active: true,
      lat: -20.02,
      lng: 57.59,
      radiusMeters: 150,
    );

    final resolved = journeyOriginGeofence(
      journey,
      const [office, home],
      imei: 'watch-1',
    );

    expect(resolved?.id, 'home-id');
    expect(resolved?.radiusMeters, 150);
  });
}

void _noop() {}

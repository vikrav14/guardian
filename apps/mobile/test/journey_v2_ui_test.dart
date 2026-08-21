import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_v2_data.dart';
import 'package:guardian/journey/journey_v2_static_map.dart';
import 'package:guardian/journey/journey_v2_ui.dart';

Future<void> pumpJourneyUi(WidgetTester tester) async {
  // The replay halo intentionally breathes forever, so pumpAndSettle would
  // correctly never settle. Advance enough time for layout/navigation while
  // leaving the continuous animation running.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  JourneyRecord record({
    required String id,
    required int hour,
    required double km,
    required int pointCount,
  }) {
    final start = DateTime(2026, 8, 10, hour);
    return JourneyRecord(
      id: id,
      startAt: start,
      endAt: start.add(const Duration(minutes: 45)),
      polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      distanceKm: km,
      pointCount: pointCount,
      closeReason: 'return_to_origin',
      originGeofenceName: 'Home',
      departureAt: start.add(const Duration(minutes: 1)),
      returnAt: start.add(const Duration(minutes: 45)),
      evidenceVersion: 3,
      routeStartAnchored: true,
      pointEvidence: [
        for (var index = 0; index < pointCount; index++)
          JourneyPointEvidence(
            offsetMs: pointCount <= 1
                ? 0
                : (45 * 60 * 1000 * index) ~/ (pointCount - 1),
            source: 'gps',
            gpsValid: true,
          ),
      ],
    );
  }

  testWidgets('desktop layout separates day summary and selected trip', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 1050));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final journeys = [
      record(id: 'trip-1', hour: 8, km: 2.1, pointCount: 3),
      record(id: 'trip-2', hour: 10, km: 8.3, pointCount: 3),
      record(id: 'trip-3', hour: 12, km: 21.9, pointCount: 3),
    ];
    final selected = journeyV2SelectRecord(journeys);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: JourneyV2Dashboard(
            deviceName: 'Jesh',
            day: DateTime(2026, 8, 10),
            journeys: journeys,
            selected: selected,
            onSelectJourney: (_) {},
            onBack: () {},
            onChooseDay: () {},
          ),
        ),
      ),
    );
    await pumpJourneyUi(tester);

    expect(find.textContaining('Jesh'), findsWidgets);
    expect(find.text("TODAY'S JOURNEY OVERVIEW"), findsOneWidget);
    expect(find.text('TRIPS'), findsOneWidget);
    expect(find.byKey(const ValueKey('journey-map-trip-3')), findsOneWidget);
    expect(find.byKey(const ValueKey('journey-replay-toggle')), findsOneWidget);
    expect(find.text('SELECTED TRIP'), findsOneWidget);
    expect(find.text('GUARDIAN READ'), findsNWidgets(2));
    expect(find.text('JOURNEY STORY'), findsOneWidget);
    expect(find.textContaining('Recorded movement'), findsOneWidget);
    expect(find.text('Location points'), findsOneWidget);
    expect(find.text('GPS location points'), findsOneWidget);
    expect(find.textContaining('route points'), findsNothing);
    expect(find.byKey(const ValueKey('journey-expand-map')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('journey-expand-map')));
    await pumpJourneyUi(tester);

    expect(
      find.byKey(const ValueKey('journey-fullscreen-map-trip-3')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('journey-close-fullscreen-map')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('journey-replay-toggle')), findsOneWidget);
    expect(find.byKey(const ValueKey('journey-map-type-toggle')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('journey-fit-complete-route')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('journey-toggle-source-evidence')),
      findsOneWidget,
    );
    expect(find.text('Show source evidence'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('journey-replay-location-card')),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(const ValueKey('journey-toggle-source-evidence')),
    );
    await tester.pump();

    expect(find.text('Hide source evidence'), findsOneWidget);
    final fullScreenMap = tester.widget<JourneyV2StaticMap>(
      find.byKey(const ValueKey('journey-fullscreen-map-trip-3')),
    );
    expect(fullScreenMap.showSourceEvidence, isTrue);
  });

  testWidgets('trip row remains selectable', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1400, 1050));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final journeys = [
      record(id: 'trip-1', hour: 8, km: 2.1, pointCount: 3),
      record(id: 'trip-2', hour: 10, km: 8.3, pointCount: 3),
    ];
    JourneyRecord? tapped;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: JourneyV2Dashboard(
            deviceName: 'Jesh',
            day: DateTime(2026, 8, 10),
            journeys: journeys,
            selected: journeys.first,
            onSelectJourney: (journey) => tapped = journey,
            onBack: () {},
            onChooseDay: () {},
          ),
        ),
      ),
    );
    await pumpJourneyUi(tester);

    final trip2 = find.byKey(const ValueKey('journey-trip-trip-2'));
    expect(trip2, findsOneWidget);

    await tester.tap(trip2);
    await pumpJourneyUi(tester);

    expect(tapped?.id, 'trip-2');
  });

  testWidgets('legacy ghost journey is not presented as a confirmed trip', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 1050));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final start = DateTime(2026, 8, 17, 12, 10);
    final ghost = JourneyRecord(
      id: 'wifi-ghost',
      startAt: start,
      endAt: start.add(const Duration(minutes: 3, seconds: 58)),
      polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      distanceKm: 2.1,
      pointCount: 11,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: JourneyV2Dashboard(
            deviceName: 'Jesh',
            day: DateTime(2026, 8, 17),
            journeys: [ghost],
            selected: ghost,
            onSelectJourney: (_) {},
            onBack: () {},
            onChooseDay: () {},
          ),
        ),
      ),
    );
    await pumpJourneyUi(tester);

    expect(find.text('No confirmed journey recorded.'), findsOneWidget);
    expect(find.byKey(const ValueKey('journey-map-wifi-ghost')), findsNothing);
    expect(find.textContaining('2.1 km'), findsNothing);
  });

  testWidgets('confirmed outing reports time away and the concrete route gap', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 1050));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final start = DateTime(2026, 8, 17, 12, 10);
    final journey = JourneyRecord(
      id: 'confirmed-gap',
      startAt: start,
      endAt: start.add(const Duration(minutes: 33)),
      polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      distanceKm: 1.2,
      pointCount: 3,
      closeReason: 'return_to_origin',
      originGeofenceName: 'Home',
      departureAt: start.add(const Duration(minutes: 1)),
      returnAt: start.add(const Duration(minutes: 33)),
      evidenceVersion: 3,
      routeStartAnchored: true,
      pointEvidence: const [
        JourneyPointEvidence(offsetMs: 0, source: 'gps', gpsValid: true),
        JourneyPointEvidence(
          offsetMs: 6 * 60 * 1000,
          source: 'gps',
          gpsValid: true,
        ),
        JourneyPointEvidence(
          offsetMs: 33 * 60 * 1000,
          source: 'gps',
          gpsValid: true,
        ),
      ],
      routeGaps: const [
        JourneyRouteGap(
          fromPointIndex: 1,
          toPointIndex: 2,
          fromOffsetMs: 6 * 60 * 1000,
          toOffsetMs: 33 * 60 * 1000,
          durationSeconds: 27 * 60,
        ),
      ],
      routeCoverage: const JourneyRouteCoverage(
        pointCount: 3,
        gpsPointCount: 3,
        gapCount: 1,
        largestGapSeconds: 27 * 60,
        interrupted: true,
        structureReliable: false,
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: JourneyV2Dashboard(
            deviceName: 'Jesh',
            day: DateTime(2026, 8, 17),
            journeys: [journey],
            selected: journey,
            onSelectJourney: (_) {},
            onBack: () {},
            onChooseDay: () {},
          ),
        ),
      ),
    );
    await pumpJourneyUi(tester);

    expect(find.text('Time away'), findsOneWidget);
    expect(find.text('Returned Home'), findsWidgets);
    expect(
      find.textContaining('Tracking stopped at 12:16 and resumed at 12:43'),
      findsWidgets,
    );
    expect(
      find.textContaining('Distance excludes the unobserved interval.'),
      findsOneWidget,
    );
  });

  testWidgets('hybrid map uses compact sources and names a nearby landmark', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 1050));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final start = DateTime(2026, 8, 21, 17);
    final journey = JourneyRecord(
      id: 'super-u-trip',
      startAt: start,
      endAt: start.add(const Duration(minutes: 40)),
      polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      distanceKm: 6.7,
      pointCount: 3,
      closeReason: 'return_to_origin',
      originGeofenceName: 'Home',
      departureAt: start.add(const Duration(minutes: 1)),
      returnAt: start.add(const Duration(minutes: 40)),
      evidenceVersion: 3,
      routeStartAnchored: true,
      pointEvidence: const [
        JourneyPointEvidence(offsetMs: 0, source: 'gps', gpsValid: true),
        JourneyPointEvidence(
          offsetMs: 20 * 60 * 1000,
          source: 'gps',
          gpsValid: true,
        ),
        JourneyPointEvidence(
          offsetMs: 40 * 60 * 1000,
          source: 'gps',
          gpsValid: true,
        ),
      ],
      stops: [
        JourneyStop(
          id: 'stop-super-u',
          startAt: start.add(const Duration(minutes: 15)),
          endAt: start.add(const Duration(minutes: 25)),
          durationMinutes: 10,
          centerLat: -20.01,
          centerLng: 57.59,
          pointStartIndex: 1,
          pointEndIndex: 1,
          placeName: 'Grand Baie',
        ),
      ],
    );
    final presentation = JourneyRoutePresentation(
      version: 1,
      generatedAt: DateTime(2026, 8, 21),
      expiresAt: DateTime(2099),
      segments: const [
        JourneyPresentationSegment(
          source: 'gps',
          polyline: r'_p~iF~ps|U_ulLnnqC',
          fromPointIndex: 0,
          toPointIndex: 1,
          fromOffsetMs: 0,
          toOffsetMs: 20 * 60 * 1000,
        ),
        JourneyPresentationSegment(
          source: 'google',
          polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
          fromPointIndex: 1,
          toPointIndex: 2,
          fromOffsetMs: 20 * 60 * 1000,
          toOffsetMs: 40 * 60 * 1000,
        ),
      ],
      stopPlaces: const [
        JourneyStopPlace(
          stopId: 'stop-super-u',
          pointStartIndex: 1,
          pointEndIndex: 1,
          placeId: 'super-u-grand-baie',
          label: 'Near Super U Grand Baie',
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: JourneyV2Dashboard(
            deviceName: 'Jesh',
            day: DateTime(2026, 8, 21),
            journeys: [journey],
            selected: journey,
            presentation: presentation,
            onSelectJourney: (_) {},
            onBack: () {},
            onChooseDay: () {},
          ),
        ),
      ),
    );
    await pumpJourneyUi(tester);

    expect(find.text('GPS'), findsOneWidget);
    expect(find.text('Google'), findsOneWidget);
    expect(find.textContaining('Near Super U Grand Baie'), findsOneWidget);
    expect(find.text('Nearby places · Google Maps'), findsOneWidget);
    expect(find.text('Recorded route'), findsNothing);
    expect(find.text('Location unavailable'), findsNothing);
    expect(find.text('Confirmed Home'), findsNothing);
  });
}

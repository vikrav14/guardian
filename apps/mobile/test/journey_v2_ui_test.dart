import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_v2_data.dart';
import 'package:guardian/journey/journey_v2_ui.dart';

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
    await tester.pumpAndSettle();

    expect(find.textContaining('Jesh'), findsWidgets);
    expect(find.text("TODAY'S JOURNEY OVERVIEW"), findsOneWidget);
    expect(find.text('TRIPS'), findsOneWidget);
    expect(find.byKey(const ValueKey('journey-map-trip-3')), findsOneWidget);
    expect(find.byKey(const ValueKey('journey-replay-toggle')), findsOneWidget);
    expect(find.text('SELECTED TRIP'), findsOneWidget);
    expect(find.text('GUARDIAN READ'), findsNWidgets(2));
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
    await tester.pumpAndSettle();

    final trip2 = find.byKey(const ValueKey('journey-trip-trip-2'));
    expect(trip2, findsOneWidget);

    await tester.tap(trip2);
    await tester.pumpAndSettle();

    expect(tapped?.id, 'trip-2');
  });
}

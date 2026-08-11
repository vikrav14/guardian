import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_v2_ui.dart';

void main() {
  testWidgets('selected trip shows factual structured stop summary', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 1050));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final start = DateTime(2026, 8, 11, 10);
    final stopStart = start.add(const Duration(minutes: 8));
    final stopEnd = start.add(const Duration(minutes: 16));

    final journey = JourneyRecord(
      id: 'structured-trip',
      startAt: start,
      endAt: start.add(const Duration(minutes: 30)),
      polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      distanceKm: 4.2,
      pointCount: 7,
      stops: [
        JourneyStop(
          id: 'stop_1',
          startAt: stopStart,
          endAt: stopEnd,
          durationMinutes: 8,
          centerLat: -20.255,
          centerLng: 57.484,
          pointStartIndex: 2,
          pointEndIndex: 4,
        ),
      ],
      legs: [
        JourneyLeg(
          id: 'leg_1',
          startAt: start,
          endAt: stopStart,
          durationMinutes: 8,
          distanceKm: 2.1,
          pointStartIndex: 0,
          pointEndIndex: 2,
          toStopId: 'stop_1',
        ),
        JourneyLeg(
          id: 'leg_2',
          startAt: stopEnd,
          endAt: start.add(const Duration(minutes: 30)),
          durationMinutes: 14,
          distanceKm: 2.1,
          pointStartIndex: 4,
          pointEndIndex: 6,
          fromStopId: 'stop_1',
        ),
      ],
      stopCount: 1,
      legCount: 2,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: JourneyV2Dashboard(
            deviceName: 'Jesh',
            day: DateTime(2026, 8, 11),
            journeys: [journey],
            selected: journey,
            onSelectJourney: (_) {},
            onBack: () {},
            onChooseDay: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('1 \u00B7 8m'), findsOneWidget);
    expect(find.text('Stops'), findsOneWidget);
    expect(
      find.textContaining('1 stop was recorded during this outing'),
      findsOneWidget,
    );
  });
}

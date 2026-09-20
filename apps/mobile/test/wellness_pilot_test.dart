import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/activity_day.dart';
import 'package:guardian/models/wellbeing_reading.dart';
import 'package:guardian/wellness/wellness_card.dart';
import 'package:guardian/wellness/wellness_sample.dart';

void main() {
  final now = DateTime.utc(2026, 9, 14, 20, 40);

  test('customer estimates preserve source quality without promoting records', () {
    final day = <String, dynamic>{
      'schemaVersion': 2,
      'aggregation': 'observed_delta',
      'localDate': '2026-09-15',
      'recordedSteps': 63,
      'reportedSteps': null,
      'displayable': false,
      'lastObservedAt': now,
    };
    final activity = ActivityDay.fromMap(day);
    expect(activity.steps, 63);
    expect(activity.partialCoverage, isTrue);
    expect(day['reportedSteps'], isNull);

    final health = <String, dynamic>{
      'metricSet': 'spo2',
      'observedAt': now,
      'displayable': false,
      'quality': 'transport_valid_unverified',
      'values': {'spo2Percent': 97},
    };
    final reading = WellbeingReading.fromMap(health, id: 'example');
    expect(reading.spo2Percent, 97);
    expect(reading.displayable, isFalse);
    expect(reading.quality, 'transport_valid_unverified');
    expect(
      () => WellbeingReading.fromMap(
        {...health, 'quality': 'unknown'},
        id: 'hidden',
      ),
      throwsStateError,
    );
    expect(
      () => WellbeingReading.fromMap(
        {...health, 'values': {'spo2Percent': 97.5}},
        id: 'invalid',
      ),
      throwsStateError,
    );
  });

  testWidgets('card labels customer estimates and keeps dates separate', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WellnessCard(
              now: now,
              readingsAvailable: true,
              days: [
                ActivityDay(
                  localDate: '2026-09-15',
                  steps: 63,
                  lastObservedAt: now,
                  quality: 'unverified',
                  partialCoverage: true,
                ),
              ],
              samples: [
                WellnessSample(
                  metric: WellnessMetric.heartRate,
                  value: '73 bpm',
                  recordedAt: now.subtract(const Duration(hours: 4)),
                ),
                WellnessSample(
                  metric: WellnessMetric.bloodOxygen,
                  value: '97 %',
                  recordedAt: now,
                ),
              ],
            ),
          ),
        ),
      ),
    );
    expect(find.text('63'), findsOneWidget);
    expect(find.text('Recorded steps today'), findsOneWidget);
    expect(
      find.textContaining('wearing at measurement time is not confirmed'),
      findsOneWidget,
    );
    expect(find.text('73 bpm'), findsNothing);
    expect(find.text('97 %'), findsOneWidget);
    expect(find.text('No reading today'), findsNWidgets(3));
    expect(tester.takeException(), isNull);
  });
}

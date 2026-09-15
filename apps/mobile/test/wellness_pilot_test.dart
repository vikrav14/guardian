import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/activity_day.dart';
import 'package:guardian/models/wellbeing_reading.dart';
import 'package:guardian/wellness/wellness_card.dart';
import 'package:guardian/wellness/wellness_pilot_access.dart';
import 'package:guardian/wellness/wellness_sample.dart';

void main() {
  final now = DateTime.utc(2026, 9, 14, 20, 40);
  test(
    'pilot adapters preserve unverified data and never promote source records',
    () {
      final day = <String, dynamic>{
        'schemaVersion': 2,
        'localDate': '2026-09-15',
        'recordedSteps': 63,
        'reportedSteps': null,
        'displayable': false,
        'lastObservedAt': now,
      };
      expect(() => ActivityDay.fromMap(day), throwsFormatException);
      expect(ActivityDay.fromPilotMap(day).steps, 63);
      expect(ActivityDay.fromPilotMap(day).partialCoverage, isTrue);
      expect(day['reportedSteps'], isNull);
      final health = <String, dynamic>{
        'metricSet': 'spo2',
        'observedAt': now,
        'displayable': false,
        'values': {'spo2Percent': 97},
      };
      expect(
        () => WellbeingReading.fromMap(health, id: 'example'),
        throwsStateError,
      );
      final preview = WellbeingReading.fromMap(
        health,
        id: 'example',
        pilotPreview: true,
      );
      expect(preview.spo2Percent, 97);
      expect(preview.displayable, isFalse);
      expect(preview.quality, 'pilot_unverified');
      expect(
        () => WellbeingReading.fromMap(
          {...health, 'metricSet': 'temperature'},
          id: 'x',
          pilotPreview: true,
        ),
        throwsStateError,
      );
      expect(
        () => WellbeingReading.fromMap(
          {
            ...health,
            'values': {'spo2Percent': 97.5},
          },
          id: 'x',
          pilotPreview: true,
        ),
        throwsStateError,
      );
    },
  );
  testWidgets(
    'pilot card labels evidence and does not move yesterday readings into today',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: WellnessCard(
                now: now,
                pilotPreview: true,
                readingsAvailable: true,
                days: [
                  ActivityDay(
                    localDate: '2026-09-15',
                    steps: 63,
                    lastObservedAt: now,
                    quality: 'pilot_unverified',
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
        find.textContaining('Wearing at measurement time is unconfirmed'),
        findsOneWidget,
      );
      expect(find.text('73 bpm'), findsNothing);
      expect(find.text('97 %'), findsOneWidget);
      expect(find.text('No reading today'), findsNWidgets(3));
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('grant expiry and revocation unmount private data', (
    tester,
  ) async {
    final grants = StreamController<List<WellnessPilotGrant>>();
    addTearDown(grants.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: WellnessPilotAccess(
            imei: 'synthetic-watch',
            grants: grants.stream,
            child: const Text('private reading'),
            unavailableChild: const Text('routine unavailable'),
          ),
        ),
      ),
    );
    final at = DateTime.now();
    grants.add([
      WellnessPilotGrant(at, at.add(const Duration(seconds: 2)), true),
    ]);
    await tester.pump();
    await tester.pump();
    expect(find.text('private reading'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    expect(find.text('private reading'), findsNothing);
    expect(find.text('routine unavailable'), findsOneWidget);
    grants.add([
      WellnessPilotGrant(
        DateTime.now(),
        DateTime.now().add(const Duration(hours: 1)),
        true,
      ),
    ]);
    await tester.pump();
    await tester.pump();
    expect(find.text('private reading'), findsOneWidget);
    grants.add([]);
    await tester.pump();
    await tester.pump();
    expect(find.text('private reading'), findsNothing);
    expect(find.text('routine unavailable'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}

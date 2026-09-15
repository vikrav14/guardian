import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/activity_day.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/wellness/wellness_card.dart';
import 'package:guardian/wellness/wellness_sample.dart';
import 'package:guardian/wellness/wellness_window.dart';

GuardianSubscription plan(String name) => GuardianSubscription.fromMap({
  'version': 1,
  'managedBy': 'guardian_admin',
  'plan': name,
  'status': 'active',
});
void main() {
  final now = DateTime.utc(2026, 9, 14, 20);
  testWidgets('observed step totals are visibly labelled as a partial day', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WellnessCard(
              now: now,
              activityAvailable: true,
              samples: const [],
              days: [
                ActivityDay(
                  localDate: '2026-09-15',
                  steps: 98,
                  lastObservedAt: now,
                  quality: 'partial',
                  partialCoverage: true,
                ),
              ],
            ),
          ),
        ),
      ),
    );
    expect(find.text('98'), findsOneWidget);
    expect(find.textContaining('Partial day'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  test(
    'Mauritius date changes at UTC 20:00; history is bounded per edition',
    () {
      expect(wellnessDateKey(now), '2026-09-15');
      expect(
        wellnessDateKey(now.subtract(const Duration(milliseconds: 1))),
        '2026-09-14',
      );
      final essential = WellnessWindow.forSubscription(
        plan('essential'),
        now: now,
      );
      expect(essential.start, now);
      expect(
        () => WellnessWindow.forSubscription(
          plan('essential'),
          now: now,
          before: now,
        ),
        throwsStateError,
      );
      final family = WellnessWindow.forSubscription(
        plan('family'),
        now: now,
        days: 100,
      );
      expect(family.end.difference(family.start).inDays, 7);
      expect(
        () => WellnessWindow.forSubscription(
          plan('family'),
          now: now,
          before: now,
          days: 7,
        ),
        throwsStateError,
      );
      final care = WellnessWindow.forSubscription(
        plan('care'),
        now: now,
        before: now.subtract(const Duration(days: 400)),
      );
      expect(care.end.isBefore(now.subtract(const Duration(days: 399))), true);
    },
  );
  for (final size in [const Size(360, 900), const Size(1440, 1000)]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets(
        'Wellness card works at $size, text $scale; yesterday is not today',
        (tester) async {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          await tester.pumpWidget(
            MaterialApp(
              home: MediaQuery(
                data: MediaQueryData(
                  size: size,
                  textScaler: TextScaler.linear(scale),
                ),
                child: Scaffold(
                  body: SingleChildScrollView(
                    child: WellnessCard(
                      now: now,
                      days: [
                        ActivityDay(
                          localDate: '2026-09-14',
                          steps: 4321,
                          lastObservedAt: now.subtract(
                            const Duration(seconds: 10),
                          ),
                          quality: 'partial',
                        ),
                      ],
                      samples: [
                        WellnessSample(
                          metric: WellnessMetric.heartRate,
                          value: '72 bpm',
                          recordedAt: now.subtract(const Duration(seconds: 10)),
                        ),
                        WellnessSample(
                          metric: WellnessMetric.bloodPressure,
                          value: '130/80 mmHg',
                          recordedAt: now.subtract(const Duration(seconds: 10)),
                        ),
                        WellnessSample(
                          metric: WellnessMetric.bloodPressure,
                          value: '124/78 mmHg',
                          recordedAt: now,
                        ),
                      ],
                      readingsAvailable: true,
                    ),
                  ),
                ),
              ),
            ),
          );
          expect(find.text('4,321'), findsNothing);
          expect(find.text('72 bpm'), findsNothing);
          expect(find.text('130/80 mmHg'), findsNothing);
          expect(find.text('124/78 mmHg'), findsOneWidget);
          expect(find.text('Watch estimate'), findsOneWidget);
          expect(find.text('No reading today'), findsNWidgets(3));
          expect(find.text('Not available yet'), findsOneWidget);
          expect(find.text('View wellness'), findsNothing);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
  testWidgets('each metric keeps its age and history action works', (
    tester,
  ) async {
    var opened = false;
    final clock = now.add(const Duration(hours: 5));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WellnessCard(
              now: clock,
              days: const [],
              readingsAvailable: true,
              onOpen: () => opened = true,
              samples: [
                WellnessSample(
                  metric: WellnessMetric.heartRate,
                  value: '72 bpm',
                  recordedAt: clock.subtract(const Duration(minutes: 12)),
                ),
                WellnessSample(
                  metric: WellnessMetric.bloodOxygen,
                  value: '97 %',
                  recordedAt: clock.subtract(const Duration(hours: 2)),
                ),
                WellnessSample(
                  metric: WellnessMetric.bloodPressure,
                  value: '124/78 mmHg',
                  recordedAt: clock.subtract(const Duration(minutes: 27)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    expect(find.text('12m ago'), findsOneWidget);
    expect(find.text('2h ago · older reading'), findsOneWidget);
    expect(find.text('124/78 mmHg'), findsOneWidget);
    expect(find.text('27m ago'), findsOneWidget);
    await tester.ensureVisible(find.text('View wellness'));
    await tester.tap(find.text('View wellness'));
    expect(opened, true);
  });
}

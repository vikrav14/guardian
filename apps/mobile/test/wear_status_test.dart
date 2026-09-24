import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/wear_status.dart';
import 'package:guardian/wellness/wellness_card.dart';
import 'package:guardian/wellness/wellness_sample.dart';

void main() {
  final now = DateTime.utc(2026, 9, 14, 18);
  WearStatus status(String state) => WearStatus.fromMap({
    'version': 1, 'state': state, 'deviceAccepted': true,
    'observedAt': now, 'expiresAt': now.add(const Duration(seconds: 120)),
  });

  test('wearing freshness expires locally even if Firestore sends no update', () {
    expect(status('worn').stateAt(now), 'worn');
    expect(status('worn').stateAt(now.add(const Duration(seconds: 120))), 'unknown');
    expect(status('removed').stateAt(now), 'removed');
    expect(status('removed').stateAt(now.subtract(const Duration(seconds: 1))), 'unknown');
    expect(const WearStatus(state: 'worn').stateAt(now), 'unknown');
  });

  testWidgets('removal retains the last eligible reading and its original age', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(
      child: WellnessCard(days: const [], readingsAvailable: true,
        samples: [WellnessSample(metric: WellnessMetric.heartRate,
          value: '86 bpm', recordedAt: now.subtract(const Duration(minutes: 20)))],
        now: now, wearStatus: status('removed')),
    ))));
    expect(find.text('Watch removed · new readings are excluded'), findsOneWidget);
    expect(find.text('86 bpm'), findsOneWidget);
    expect(find.text('20m ago'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unconfirmed wearing remains explicit and missing steps are not zero', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(
      child: WellnessCard(days: const [], samples: const [], now: now),
    ))));
    expect(find.text('Wearing status unconfirmed'), findsOneWidget);
    expect(find.text('—'), findsOneWidget);
    expect(find.text('0'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}

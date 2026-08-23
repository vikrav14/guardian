import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/wellbeing_reading.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/care/wellbeing_readings_panel.dart';

void main() {
  Widget app(Widget child) => MaterialApp(
    theme: buildGuardianTheme(),
    home: Scaffold(body: child),
  );

  testWidgets('shows exact estimates, freshness and medical boundary', (tester) async {
    final now = DateTime.utc(2026, 8, 23, 14, 5);
    await tester.pumpWidget(app(WellbeingReadingsPanel(
      allowed: true,
      now: now,
      readings: Stream.value([
        WellbeingReading(
          id: 'oxygen',
          metricSet: WellbeingMetricSet.spo2,
          observedAt: now.subtract(const Duration(minutes: 2)),
          quality: 'device_accepted',
          displayable: true,
          spo2Percent: 98,
        ),
        WellbeingReading(
          id: 'heart',
          metricSet: WellbeingMetricSet.heartRateBloodPressure,
          observedAt: now.subtract(const Duration(minutes: 3)),
          quality: 'device_accepted',
          displayable: true,
          heartRateBpm: 72,
          systolicMmHg: 120,
          diastolicMmHg: 72,
        ),
      ]),
    )));
    await tester.pump();

    expect(find.text('Latest wellbeing'), findsOneWidget);
    expect(find.text('Updated 2 min ago'), findsOneWidget);
    expect(find.text('98% oxygen estimate'), findsOneWidget);
    expect(find.text('72 bpm · 120/72 mmHg'), findsOneWidget);
    expect(find.textContaining('not medical measurements'), findsOneWidget);
    expect(find.textContaining('normal'), findsNothing);
  });

  testWidgets('shows the Care boundary without subscribing to readings', (tester) async {
    await tester.pumpWidget(app(const WellbeingReadingsPanel(
      allowed: false,
      readings: Stream.empty(),
    )));
    expect(
      find.text('Wellbeing insights are available with Guardian Care.'),
      findsOneWidget,
    );
  });

  testWidgets('does not present an old estimate as a current reading', (tester) async {
    final now = DateTime.utc(2026, 8, 23, 16);
    await tester.pumpWidget(app(WellbeingReadingsPanel(
      allowed: true,
      now: now,
      readings: Stream.value([
        WellbeingReading(
          id: 'old-heart',
          metricSet: WellbeingMetricSet.heartRateBloodPressure,
          observedAt: now.subtract(const Duration(hours: 2)),
          quality: 'device_accepted',
          displayable: true,
          heartRateBpm: 72,
          systolicMmHg: 120,
          diastolicMmHg: 72,
        ),
      ]),
    )));
    await tester.pump();
    expect(find.text('No recent reading · last update 2 h ago'), findsOneWidget);
  });
}

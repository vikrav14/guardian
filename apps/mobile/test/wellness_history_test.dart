import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/activity_day.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/wellness/wellness_chart.dart';
import 'package:guardian/wellness/wellness_history.dart';
import 'package:guardian/wellness/wellness_sample.dart';
import 'package:guardian/wellness/wellness_trends.dart';
import 'package:guardian/wellness/wellness_window.dart';

void main() {
  final now = DateTime.utc(2026, 9, 16, 14);
  final start = wellnessDayStart(now).subtract(const Duration(days: 6));
  final window = WellnessWindow(
    start,
    wellnessDayStart(now).add(const Duration(days: 1)),
  );
  WellnessSample sample(
    WellnessMetric metric,
    num value,
    DateTime at, {
    num? secondary,
  }) => WellnessSample(
    metric: metric,
    value: secondary == null
        ? '$value ${metric.unit}'
        : '$value/$secondary ${metric.unit}',
    recordedAt: at,
    numericValue: value,
    secondaryValue: secondary,
  );
  final samples = [
    sample(
      WellnessMetric.heartRate,
      72,
      now.subtract(const Duration(minutes: 3)),
    ),
    sample(WellnessMetric.heartRate, 81, now.subtract(const Duration(days: 2))),
    sample(
      WellnessMetric.bloodOxygen,
      98,
      now.subtract(const Duration(minutes: 5)),
    ),
    sample(
      WellnessMetric.bloodPressure,
      118,
      now.subtract(const Duration(minutes: 3)),
      secondary: 76,
    ),
    sample(
      WellnessMetric.skinTemperature,
      34.56,
      now.subtract(const Duration(minutes: 8)),
    ),
    sample(WellnessMetric.heartRate, 199, now.add(const Duration(minutes: 2))),
    sample(
      WellnessMetric.heartRate,
      188,
      start.subtract(const Duration(seconds: 1)),
    ),
  ];
  final days = [
    ActivityDay(
      localDate: wellnessDateKey(now),
      steps: 321,
      lastObservedAt: now,
      quality: 'partial',
      partialCoverage: true,
    ),
    ActivityDay(
      localDate: wellnessDateKey(now.subtract(const Duration(days: 2))),
      steps: 0,
      lastObservedAt: now.subtract(const Duration(days: 2)),
      quality: 'partial',
    ),
  ];

  test(
    'trend window excludes future/older records and counts only observed days',
    () {
      final series = WellnessTrend(
        metric: WellnessMetric.heartRate,
        window: window,
        samples: samples,
        now: now,
        pilotPreview: false,
      );
      expect(series.points.map((p) => p.numericValue), [81, 72]);
      expect(series.range, '72–81 bpm');
      expect(series.daysWithReadings, 2);
      expect(series.daysInWindow, 7);
      expect(series.latest!.numericValue, 72);
      final midnight = DateTime.utc(2026, 9, 16, 20);
      final today = WellnessWindow(
        wellnessDayStart(midnight),
        wellnessDayStart(midnight).add(const Duration(days: 1)),
      );
      expect(
        WellnessTrend(
          metric: WellnessMetric.heartRate,
          window: today,
          samples: samples,
          now: midnight,
          pilotPreview: false,
        ).readings,
        isEmpty,
      );
    },
  );

  test(
    'chart values require typed finite values and a complete pressure pair',
    () {
      final rows = [
        WellnessSample(
          metric: WellnessMetric.heartRate,
          value: '73 bpm',
          recordedAt: now,
        ),
        sample(WellnessMetric.heartRate, double.nan, now),
        sample(WellnessMetric.heartRate, double.infinity, now),
        sample(WellnessMetric.heartRate, 0, now),
      ];
      expect(
        WellnessTrend(
          metric: WellnessMetric.heartRate,
          window: window,
          samples: rows,
          now: now,
          pilotPreview: false,
        ).points,
        isEmpty,
      );
      expect(sample(WellnessMetric.bloodPressure, 118, now).canPlot, isFalse);
      expect(
        sample(WellnessMetric.bloodPressure, 118, now, secondary: 76).canPlot,
        isTrue,
      );
      expect(
        WellnessTrend(
          metric: WellnessMetric.skinTemperature,
          window: window,
          samples: samples,
          now: now,
          pilotPreview: false,
        ).readings,
        isEmpty,
      );
    },
  );

  test(
    'activity retains a real zero, filters dates and chooses the latest duplicate',
    () {
      final accepted = wellnessActivityDays(
        days: [
          ...days,
          ActivityDay(
            localDate: wellnessDateKey(now),
            steps: 99,
            lastObservedAt: now.subtract(const Duration(minutes: 2)),
            quality: 'partial',
          ),
          ActivityDay(
            localDate: wellnessDateKey(now),
            steps: 999,
            lastObservedAt: now.add(const Duration(minutes: 2)),
            quality: 'partial',
          ),
          ActivityDay(
            localDate: '2026-01-01',
            steps: 777,
            lastObservedAt: DateTime.utc(2026),
            quality: 'partial',
          ),
        ],
        window: window,
        now: now,
      );
      expect(accepted.map((d) => d.steps), [0, 321]);
    },
  );

  Future<void> show(
    WidgetTester tester, {
    bool preview = true,
    bool error = false,
    bool activityError = false,
    bool available = true,
    List<WellnessSample>? readings,
    Size size = const Size(1000, 1100),
    double scale = 1,
    bool dark = false,
    WellnessWindow? range,
    VoidCallback? onToday,
    VoidCallback? onWeek,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          useMaterial3: true,
          brightness: dark ? Brightness.dark : Brightness.light,
          extensions: [
            dark ? GuardianThemeColors.dark : GuardianThemeColors.light,
          ],
        ),
        home: MediaQuery(
          data: MediaQueryData(
            size: size,
            textScaler: TextScaler.linear(scale),
          ),
          child: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: WellnessHistory(
                window: range ?? window,
                days: days,
                samples: readings ?? samples,
                now: now,
                readingsAvailable: available,
                pilotPreview: preview,
                readingError: error,
                activityError: activityError,
                onToday: onToday,
                onWeek: onWeek,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'metric selection plots paired values and log groups the selected metric',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await show(tester);
      expect(find.text('Heart rate over time'), findsOneWidget);
      expect(find.text('Recorded range · 72–81 bpm'), findsOneWidget);
      expect(find.text('199 bpm'), findsNothing);
      expect(find.text('188 bpm'), findsNothing);
      expect(find.text('2 readings · 2 of 7 days with data'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('wellness-metric-bloodPressure')),
      );
      await tester.pumpAndSettle();
      final chart = tester.widget<WellnessChart>(find.byType(WellnessChart));
      expect(chart.points.single.value, 118);
      expect(chart.points.single.secondary, 76);
      expect(find.text('Systolic'), findsOneWidget);
      expect(find.text('Diastolic'), findsOneWidget);
      await tester.ensureVisible(find.text('Reading log'));
      await tester.tap(find.text('Reading log'));
      await tester.pumpAndSettle();
      expect(find.text('118/76 mmHg'), findsNWidgets(2));
      expect(find.text('81 bpm'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'temperature remains receipt-labelled and clears on preview/access loss',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await show(tester);
      await tester.tap(
        find.byKey(const ValueKey('wellness-metric-skinTemperature')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Skin temperature over time'), findsOneWidget);
      expect(
        find.text(
          'Points show receipt times. Measurement times are unconfirmed.',
        ),
        findsOneWidget,
      );
      await show(tester, preview: false);
      expect(find.textContaining('34.56'), findsNothing);
      expect(find.text('Heart rate over time'), findsOneWidget);
      await show(tester, error: true);
      expect(find.byType(WellnessChart), findsNothing);
      expect(find.text('72 bpm'), findsNothing);
      expect(find.text('Reading log'), findsNothing);
      expect(
        find.textContaining('Readings could not be verified'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'activity bar gaps differ from recorded zero and errors hide the old plot',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await show(tester);
      await tester.tap(find.byKey(const ValueKey('wellness-tab-activity')));
      await tester.pumpAndSettle();
      final chart = tester.widget<WellnessChart>(find.byType(WellnessChart));
      expect(chart.points.where((p) => p.value == null).length, 5);
      expect(chart.points.where((p) => p.value == 0).length, 1);
      expect(find.textContaining('Partial totals'), findsOneWidget);
      await show(tester, activityError: true);
      expect(find.byType(WellnessChart), findsNothing);
      expect(find.text('321'), findsNothing);
      expect(
        find.text('Activity history could not be loaded.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'empty metric has no fabricated plot and legacy text remains in the log',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await show(tester, readings: const []);
      expect(find.byType(WellnessChart), findsNothing);
      expect(find.text('No readings in this period.'), findsOneWidget);
      await show(
        tester,
        readings: [
          WellnessSample(
            metric: WellnessMetric.heartRate,
            value: '73 bpm',
            recordedAt: now,
          ),
        ],
      );
      expect(find.byType(WellnessChart), findsNothing);
      expect(
        find.textContaining('Chart values are unavailable'),
        findsOneWidget,
      );
      expect(find.text('73 bpm'), findsOneWidget);
    },
  );

  testWidgets(
    'period actions refresh the controlled window; today never includes yesterday',
    (tester) async {
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var todayRequested = false;
      var weekRequested = false;
      await show(
        tester,
        onToday: () => todayRequested = true,
        onWeek: () => weekRequested = true,
      );
      await tester.tap(find.widgetWithText(ChoiceChip, 'Today'));
      expect(todayRequested, isTrue);
      final today = WellnessWindow(wellnessDayStart(now), window.end);
      await show(
        tester,
        range: today,
        onToday: () {},
        onWeek: () => weekRequested = true,
      );
      expect(
        tester.widget<WellnessChart>(find.byType(WellnessChart)).points.length,
        1,
      );
      expect(find.text('Recorded range · 72–72 bpm'), findsOneWidget);
      await tester.tap(find.widgetWithText(ChoiceChip, '7 days'));
      expect(weekRequested, isTrue);
      expect(tester.takeException(), isNull);
    },
  );

  for (final size in [const Size(320, 1000), const Size(1200, 1100)]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets(
        'responsive metric charts and keyboard at $size text $scale',
        (tester) async {
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          await show(tester, size: size, scale: scale, dark: scale == 2);
          for (final metric in WellnessMetric.values) {
            final key = find.byKey(ValueKey('wellness-metric-${metric.name}'));
            await tester.ensureVisible(key);
            await tester.tap(key);
            await tester.pumpAndSettle();
            expect(find.text('${metric.label} over time'), findsOneWidget);
            expect(tester.takeException(), isNull);
          }
          final plot = find.byKey(const ValueKey('wellness-chart-plot'));
          await tester.ensureVisible(plot);
          Focus.of(tester.element(plot)).requestFocus();
          await tester.pump();
          await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
          await tester.pump();
          expect(find.textContaining('MUT · 34.56 °C'), findsOneWidget);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}

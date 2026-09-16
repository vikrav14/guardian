// Synthetic fixtures rendered through the production Wellness widgets.
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/activity_day.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/screens/watch_preferences_page.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/wellness/wellness_routine.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/wellness/wellness_card.dart';
import 'package:guardian/wellness/wellness_history.dart';
import 'package:guardian/wellness/wellness_sample.dart';
import 'package:guardian/wellness/wellness_window.dart';
import '../test/support/dashboard_fixture.dart';

const enabled = bool.fromEnvironment('WELLNESS_PREVIEWS');
void main() {
  for (final width in [390.0, 1280.0]) {
    for (final routine in [false, true]) {
      testWidgets('render shared settings $routine at $width', (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(width, routine ? 1500 : 1900);
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.runAsync(() async {
          final font = FontLoader('WellnessPreview')
            ..addFont(
              Future.value(
                ByteData.sublistView(
                  await File(
                    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                  ).readAsBytes(),
                ),
              ),
            );
          await font.load();
          final icons = FontLoader('MaterialIcons')
            ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
          await icons.load();
        });
        final subscription = GuardianSubscription.fromMap({
          'version': 1,
          'managedBy': 'guardian_admin',
          'plan': 'family',
          'status': 'active',
        });
        final key = GlobalKey();
        await tester.pumpWidget(
          MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: ThemeData(
              useMaterial3: true,
              fontFamily: 'WellnessPreview',
              extensions: const [GuardianThemeColors.light],
              colorScheme: ColorScheme.fromSeed(
                seedColor: GuardianThemeColors.light.accent,
              ),
            ),
            home: RepaintBoundary(
              key: key,
              child: routine
                  ? WellnessRoutinePage(
                      imei: 'synthetic',
                      subscription: subscription,
                      pilotPreview: false,
                    )
                  : WatchPreferencesPage(
                      device: const Device(
                        imei: 'synthetic',
                        nickname: 'Sample wearer',
                        online: false,
                      ),
                      subscription: subscription,
                    ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await save(
          tester,
          key,
          '${routine ? 'routine' : 'preferences'}_${width.toInt()}',
        );
        await tester.pumpWidget(const SizedBox());
      }, skip: !enabled);
    }
  }
  final now = DateTime.utc(2026, 9, 14, 12);
  final days = [
    for (var n = 0; n < 7; n++)
      ActivityDay(
        localDate: wellnessDateKey(now.subtract(Duration(days: n))),
        steps: [3280, 4012, 2985, 3651, 4120, 3450, 2760][n],
        lastObservedAt: now.subtract(Duration(days: n, minutes: 5)),
        quality: 'partial',
      ),
  ];
  final samples = [
    WellnessSample(
      metric: WellnessMetric.heartRate,
      value: '72 bpm',
      numericValue: 72,
      recordedAt: now.subtract(const Duration(minutes: 12)),
    ),
    WellnessSample(
      metric: WellnessMetric.bloodOxygen,
      value: '97 %',
      numericValue: 97,
      recordedAt: now.subtract(const Duration(minutes: 18)),
    ),
    WellnessSample(
      metric: WellnessMetric.bloodPressure,
      value: '118/76 mmHg',
      numericValue: 118,
      secondaryValue: 76,
      recordedAt: now.subtract(const Duration(minutes: 12)),
    ),
  ];
  for (final plan in ['essential', 'family', 'care']) {
    for (final width in [390.0, 1280.0]) {
      testWidgets('render $plan Wellness at $width', (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(width, 2200);
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.runAsync(() async {
          final font = FontLoader('WellnessPreview');
          font.addFont(
            Future.value(
              ByteData.sublistView(
                await File(
                  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                ).readAsBytes(),
              ),
            ),
          );
          await font.load();
          final icons = FontLoader('MaterialIcons');
          icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
          await icons.load();
        });
        final boundaryKey = GlobalKey();
        await tester.pumpWidget(
          dashboardFixtureHost(
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Guardian ${plan[0].toUpperCase()}${plan.substring(1)} · Sample data',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 14),
                dashboardFixtureOverview(
                  device: dashboardFixtureDevice(),
                  onCall: () {},
                  onJourney: () {},
                  onSafeZones: () {},
                  wellness: WellnessCard(
                    days: days,
                    samples: samples,
                    now: now,
                    readingsAvailable: true,
                    onOpen: plan == 'essential' ? null : () {},
                    onRoutine: () {},
                  ),
                ),
              ],
            ),
            boundaryKey: boundaryKey,
            fontFamily: 'WellnessPreview',
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await save(tester, boundaryKey, '${plan}_${width.toInt()}');
        if (plan != 'essential') {
          final subscription = GuardianSubscription.fromMap({
            'version': 1,
            'managedBy': 'guardian_admin',
            'plan': plan,
            'status': 'active',
          });
          await tester.pumpWidget(
            dashboardFixtureHost(
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 900),
                  child: WellnessHistory(
                    window: WellnessWindow.forSubscription(
                      subscription,
                      now: now,
                    ),
                    days: [
                      for (final day in days.where(
                        (day) =>
                            day.localDate !=
                            wellnessDateKey(
                              now.subtract(const Duration(days: 2)),
                            ),
                      ))
                        ActivityDay(
                          localDate: day.localDate,
                          steps: day.steps,
                          lastObservedAt: day.lastObservedAt,
                          quality: 'partial',
                          partialCoverage: true,
                        ),
                    ],
                    samples: [
                      ...samples,
                      WellnessSample(
                        metric: WellnessMetric.skinTemperature,
                        value: '34.56 °C',
                        numericValue: 34.56,
                        recordedAt: now.subtract(const Duration(minutes: 4)),
                      ),
                      for (var n = 1; n <= 6; n++) ...[
                        WellnessSample(
                          metric: WellnessMetric.heartRate,
                          value: '${[70, 76, 74, 80, 77, 73][n - 1]} bpm',
                          numericValue: [70, 76, 74, 80, 77, 73][n - 1],
                          recordedAt: now.subtract(Duration(days: n)),
                        ),
                        WellnessSample(
                          metric: WellnessMetric.bloodOxygen,
                          value: '${n.isEven ? 97 : 98} %',
                          numericValue: n.isEven ? 97 : 98,
                          recordedAt: now.subtract(Duration(days: n)),
                        ),
                        WellnessSample(
                          metric: WellnessMetric.bloodPressure,
                          value:
                              '${[120, 118, 122, 119, 117, 121][n - 1]}/${[78, 76, 79, 77, 75, 78][n - 1]} mmHg',
                          numericValue: [120, 118, 122, 119, 117, 121][n - 1],
                          secondaryValue: [78, 76, 79, 77, 75, 78][n - 1],
                          recordedAt: now.subtract(Duration(days: n)),
                        ),
                        WellnessSample(
                          metric: WellnessMetric.skinTemperature,
                          value: '${(34.2 + n * .05).toStringAsFixed(2)} °C',
                          numericValue: 34.2 + n * .05,
                          recordedAt: now.subtract(Duration(days: n)),
                        ),
                      ],
                    ],
                    now: now,
                    pilotPreview: true,
                    readingsAvailable: true,
                    onToday: () {},
                    onWeek: () {},
                    onPrevious: plan == 'care' ? () {} : null,
                    onChooseDate: plan == 'care' ? () {} : null,
                    onAsk: () {},
                    onRoutine: () {},
                    planDescription: subscription.wellnessHistoryDescription,
                  ),
                ),
              ),
              boundaryKey: boundaryKey,
              fontFamily: 'WellnessPreview',
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          await save(tester, boundaryKey, '${plan}_history_${width.toInt()}');
          if (plan == 'family') {
            for (final metric in [
              WellnessMetric.bloodPressure,
              WellnessMetric.skinTemperature,
            ]) {
              await tester.tap(
                find.byKey(ValueKey('wellness-metric-${metric.name}')),
              );
              await tester.pumpAndSettle();
              expect(tester.takeException(), isNull);
              await save(
                tester,
                boundaryKey,
                '${plan}_${metric.name}_${width.toInt()}',
              );
            }
            await tester.tap(
              find.byKey(const ValueKey('wellness-tab-activity')),
            );
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
            await save(
              tester,
              boundaryKey,
              '${plan}_activity_${width.toInt()}',
            );
          }
        }
      }, skip: !enabled);
    }
  }
}

Future<void> save(WidgetTester tester, GlobalKey key, String name) async {
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    final directory = Directory('build/wellness-previews');
    await directory.create(recursive: true);
    await File(
      '${directory.path}/$name.png',
    ).writeAsBytes(data!.buffer.asUint8List());
  });
}

// Synthetic fixtures rendered through the production Wellness widgets.
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/activity_day.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/wellness/wellness_card.dart';
import 'package:guardian/wellness/wellness_history.dart';
import 'package:guardian/wellness/wellness_sample.dart';
import 'package:guardian/wellness/wellness_window.dart';
import '../test/support/dashboard_fixture.dart';

const enabled = bool.fromEnvironment('WELLNESS_PREVIEWS');
void main() {
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
      recordedAt: now.subtract(const Duration(minutes: 12)),
    ),
    WellnessSample(
      metric: WellnessMetric.bloodOxygen,
      value: '97 %',
      recordedAt: now.subtract(const Duration(minutes: 18)),
    ),
    WellnessSample(
      metric: WellnessMetric.bloodPressure,
      value: '118/76 mmHg',
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
        if (width == 390 && plan != 'essential') {
          final subscription = GuardianSubscription.fromMap({
            'version': 1,
            'managedBy': 'guardian_admin',
            'plan': plan,
            'status': 'active',
          });
          await tester.pumpWidget(
            dashboardFixtureHost(
              WellnessHistory(
                window: WellnessWindow.forSubscription(subscription, now: now),
                days: days,
                samples: samples,
                now: now,
                readingsAvailable: true,
                onPrevious: plan == 'care' ? () {} : null,
                onChooseDate: plan == 'care' ? () {} : null,
                onAsk: () {},
              ),
              boundaryKey: boundaryKey,
              fontFamily: 'WellnessPreview',
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          await save(tester, boundaryKey, '${plan}_history');
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

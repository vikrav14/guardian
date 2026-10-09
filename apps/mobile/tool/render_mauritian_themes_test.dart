// Production widgets with synthetic data, rendered offline for visual review.
// flutter test tool/render_mauritian_themes_test.dart --dart-define=THEME_PREVIEWS=true
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/models/activity_day.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/weather/profile_weather.dart';
import 'package:guardian/wellness/wellness_card.dart';
import 'package:guardian/wellness/wellness_sample.dart';
import 'package:guardian/widgets/brand/guardian_pin_logo.dart';
import 'package:guardian/widgets/cards/guardian_surface.dart';
import 'package:guardian/widgets/dashboard/profile_weather_panel.dart';
import 'package:guardian/widgets/layout/guardian_page_frame.dart';
import 'package:guardian/widgets/layout/guardian_scenic_background.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';
import 'package:guardian/widgets/theme/theme_picker.dart';

import '../test/support/dashboard_fixture.dart';
import '../test/support/profile_weather_fixture.dart';

const _enabled = bool.fromEnvironment('THEME_PREVIEWS');

void main() {
  for (final themeId in GuardianThemeId.allThemes) {
    for (final kind in ['phone', 'full', 'controls', 'wide']) {
      testWidgets('render ${themeId.storageKey} $kind', (tester) async {
        final wide = kind == 'wide';
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(
          wide ? 1360 : 390,
          kind == 'full'
              ? 2600
              : wide
              ? 1100
              : 844,
        );
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final theme = buildGuardianTheme(themeId: themeId);
        await _loadFonts(tester);
        final key = GlobalKey();
        final now = DateTime.now().toUtc();
        final device = dashboardFixtureDevice(now: now, name: 'Mum');
        final content = dashboardFixtureOverview(
          device: device,
          onCall: () {},
          onJourney: () {},
          onWatchStatus: () {},
          onSafeZones: () {},
          weather: ProfileWeatherPanel(
            now: now,
            weather: ProfileWeather.fromMap(weatherTestData(now: now)),
          ),
          wellness: WellnessCard(
            now: now,
            days: [
              ActivityDay(
                localDate:
                    '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}',
                steps: 2840,
                lastObservedAt: now.subtract(const Duration(minutes: 8)),
                quality: 'recorded',
              ),
            ],
            samples: [
              WellnessSample(
                metric: WellnessMetric.heartRate,
                value: '74 bpm',
                recordedAt: now.subtract(const Duration(minutes: 8)),
              ),
              WellnessSample(
                metric: WellnessMetric.bloodOxygen,
                value: '98%',
                recordedAt: now.subtract(const Duration(minutes: 8)),
              ),
              WellnessSample(
                metric: WellnessMetric.skinTemperature,
                value: '36.4°C',
                recordedAt: now.subtract(const Duration(minutes: 8)),
              ),
              WellnessSample(
                metric: WellnessMetric.bloodPressure,
                value: '118/78 mmHg',
                recordedAt: now.subtract(const Duration(minutes: 8)),
              ),
            ],
            readingsAvailable: true,
            onOpen: () {},
            onRoutine: () {},
          ),
        );
        await tester.pumpWidget(
          MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: theme,
            builder: (context, child) =>
                TickerMode(enabled: false, child: child!),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: RepaintBoundary(
              key: key,
              child: Scaffold(
                bottomNavigationBar: wide
                    ? null
                    : MobileBottomBar(
                        currentIndex: kind == 'controls' ? 3 : 0,
                        onTap: (_) {},
                      ),
                body: Column(
                  children: [
                    Material(
                      color: themeId.semanticColors.surface,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                        child: Row(
                          children: [
                            const Expanded(
                              child: GuardianHeaderBrandMark(
                                iconSize: 34,
                                wordmarkSize: 22,
                              ),
                            ),
                            IconButton(
                              onPressed: () {},
                              icon: const Icon(Icons.palette_outlined),
                            ),
                            IconButton(
                              onPressed: () {},
                              icon: const Icon(
                                Icons.notifications_none_rounded,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Expanded(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (wide)
                            MobileBottomBar(
                              vertical: true,
                              currentIndex: 0,
                              onTap: (_) {},
                            ),
                          Expanded(
                            child: GuardianScenicBackground(
                              child: SingleChildScrollView(
                                child: Padding(
                                  padding: EdgeInsets.fromLTRB(
                                    wide ? 32 : 16,
                                    24,
                                    wide ? 32 : 16,
                                    24,
                                  ),
                                  child: kind == 'controls'
                                      ? _Controls(themeId: themeId)
                                      : content,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
        await tester.runAsync(() async {
          await GoogleFonts.pendingFonts();
          final context = key.currentContext!;
          for (final asset in [
            themeId.sceneAsset,
            'assets/weather/weather_atlas.webp',
            'assets/brand/guardian_dodo.png',
          ]) {
            if (!context.mounted) return;
            await precacheImage(AssetImage(asset), context);
          }
        });
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await _save(tester, key, '${themeId.storageKey}_$kind');
        await tester.pumpWidget(const SizedBox());
      }, skip: !_enabled);
    }
  }
}

class _Controls extends StatelessWidget {
  const _Controls({required this.themeId});
  final GuardianThemeId themeId;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const GuardianPageHeader(
        title: 'Your Guardian',
        subtitle: 'Settings that feel at home.',
      ),
      GuardianSurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Watch preferences',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            const TextField(
              decoration: InputDecoration(
                labelText: 'Watch name',
                hintText: 'Mum',
              ),
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Fall detection'),
              value: true,
              onChanged: (_) {},
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: () {}, child: const Text('Save changes')),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () {},
              child: const Text('Emergency contacts'),
            ),
            const SizedBox(height: 8),
            const FilledButton(
              onPressed: null,
              child: Text('No changes to save'),
            ),
          ],
        ),
      ),
      const SizedBox(height: 16),
      ThemePickerTile(theme: themeId, selected: true, onTap: () {}),
    ],
  );
}

Future<void> _loadFonts(WidgetTester tester) async {
  await tester.runAsync(() async {
    final path =
        Platform.environment['DASHBOARD_PREVIEW_FONT'] ??
        'C:/Windows/Fonts/segoeui.ttf';
    final data = ByteData.sublistView(await File(path).readAsBytes());
    for (final name in ['Ahem', 'Roboto']) {
      await (FontLoader(name)..addFont(Future.value(data))).load();
    }
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
}

Future<void> _save(WidgetTester tester, GlobalKey key, String name) async {
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (data == null) throw StateError('Preview encoding failed');
    final directory = Directory('build/mauritian-theme-previews');
    await directory.create(recursive: true);
    await File('${directory.path}/$name.png').writeAsBytes(
      data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
    );
  });
}

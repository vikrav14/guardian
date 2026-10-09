// Real Flutter menu, header and dashboard. Synthetic data, no account or watch.
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/navigation/guardian_navigation_shell.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/theme/guardian_appearance.dart';
import 'package:guardian/theme/guardian_theme_scope.dart';
import 'package:guardian/weather/profile_weather.dart';
import 'package:guardian/widgets/dashboard/profile_weather_panel.dart';
import 'package:guardian/widgets/brand/guardian_pin_logo.dart';
import 'package:guardian/widgets/layout/guardian_scenic_background.dart';
import '../test/support/dashboard_fixture.dart';
import '../test/support/profile_weather_fixture.dart';

void main() {
  for (final theme in GuardianThemeId.allThemes) {
    for (final view in ['phone', 'expanded', 'small', 'desktop']) {
      testWidgets(
        '${theme.storageKey} $view',
        (tester) async {
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = Size(
            view == 'desktop'
                ? 1360
                : view == 'small'
                ? 320
                : 390,
            view == 'desktop' ? 1000 : 844,
          );
          addTearDown(tester.view.resetDevicePixelRatio);
          addTearDown(tester.view.resetPhysicalSize);
          GoogleFonts.config.allowRuntimeFetching = false;
          await tester.runAsync(() async {
            for (final family in ['Ahem', 'Roboto']) {
              final loader = FontLoader(family);
              loader.addFont(rootBundle.load('assets/fonts/Inter-Regular.ttf'));
              await loader.load();
            }
            for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
              final loader = FontLoader('Inter_$weight');
              loader.addFont(rootBundle.load('assets/fonts/Inter-$weight.ttf'));
              await loader.load();
            }
            final icons = FontLoader('MaterialIcons');
            icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
            await icons.load();
          });
          final key = GlobalKey();
          final now = DateTime.now();
          final overview = dashboardFixtureOverview(
            device: dashboardFixtureDevice(now: now, name: 'Jesh'),
            weather: ProfileWeatherPanel(
              now: now,
              weather: ProfileWeather.fromMap(weatherTestData(now: now)),
            ),
            onCall: () {},
            onJourney: () {},
            onWatchStatus: () {},
            onSafeZones: () {},
          );
          final page = GuardianScenicBackground(
            child: SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: overview,
              ),
            ),
          );
          await tester.pumpWidget(
            GuardianThemeScope(
              themeId: theme,
              appearance: GuardianAppearance(themeId: theme),
              onThemeChanged: (_) {},
              onAppearanceChanged: (_) {},
              child: MaterialApp(
                debugShowCheckedModeBanner: false,
                theme: buildGuardianTheme(themeId: theme),
                localizationsDelegates: AppLocalizations.localizationsDelegates,
                supportedLocales: AppLocalizations.supportedLocales,
                home: RepaintBoundary(
                  key: key,
                  child: GuardianNavigationShell(
                    navigatorKey: GlobalKey<NavigatorState>(),
                    pages: List.generate(6, (_) => page),
                    watchName: 'Jesh',
                    watchPageBuilder: (_) async => page,
                    headerBuilder: (go) => Material(
                      color: theme.semanticColors.surface,
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
                              tooltip: 'Notifications',
                              onPressed: () => go(4),
                              icon: const Icon(
                                Icons.notifications_none_rounded,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          );
          // Weather/connectivity artwork animates continuously. Advance a
          // bounded number of frames instead of waiting for idle forever.
          await tester.pump();
          await tester.runAsync(
            () => precacheImage(
              AssetImage(theme.sceneAsset),
              key.currentContext!,
            ),
          );
          await tester.pump(const Duration(milliseconds: 700));
          if (view == 'expanded') {
            await tester.tap(find.byTooltip('Expand menu'));
            await tester.pump();
            await tester.pump(const Duration(milliseconds: 500));
          }
          expect(tester.takeException(), isNull);
          await tester.runAsync(() async {
            final boundary =
                key.currentContext!.findRenderObject()!
                    as RenderRepaintBoundary;
            final image = await boundary.toImage(pixelRatio: 1);
            final data = await image.toByteData(format: ui.ImageByteFormat.png);
            image.dispose();
            final directory = Directory('build/menu-previews');
            await directory.create(recursive: true);
            await File(
              '${directory.path}/${theme.storageKey}_$view.png',
            ).writeAsBytes(data!.buffer.asUint8List());
          });
          await tester.pumpWidget(const SizedBox());
        },
        skip: !const bool.fromEnvironment('THEME_PREVIEWS'),
      );
    }
  }
}

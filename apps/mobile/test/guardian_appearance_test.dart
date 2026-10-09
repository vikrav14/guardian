import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/theme/guardian_appearance.dart';
import 'package:guardian/theme/guardian_theme_scope.dart';
import 'package:guardian/weather/profile_weather.dart';
import 'package:guardian/widgets/dashboard/guardian_overview_header.dart';
import 'package:guardian/widgets/dashboard/profile_weather_panel.dart';
import 'package:guardian/widgets/layout/guardian_scenic_background.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';
import 'package:guardian/widgets/theme/theme_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/dashboard_fixture.dart';
import 'support/profile_weather_fixture.dart';

double _contrast(Color a, Color b) {
  final l1 = a.computeLuminance(), l2 = b.computeLuminance();
  return ((l1 > l2 ? l1 : l2) + .05) / ((l1 < l2 ? l1 : l2) + .05);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  for (final themeId in GuardianThemeId.allThemes) {
    test(
      '${themeId.displayName} text and action labels retain readable contrast',
      () {
        final colors = themeId.semanticColors;
        expect(
          _contrast(colors.accent, colors.onAccent),
          greaterThanOrEqualTo(4.5),
        );
        expect(
          _contrast(colors.textPrimary, colors.surface),
          greaterThanOrEqualTo(4.5),
        );
        expect(
          _contrast(colors.textSecondary, colors.surfaceMuted),
          greaterThanOrEqualTo(4.5),
        );
      },
    );

    for (final width in [320.0, 390.0, 430.0]) {
      testWidgets(
        '${themeId.displayName} weather and controls fit $width with large text',
        (tester) async {
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = Size(width, 844);
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          var calls = 0;
          await tester.pumpWidget(
            MaterialApp(
              theme: buildGuardianTheme(themeId: themeId),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: const TextScaler.linear(2)),
                child: child!,
              ),
              home: Scaffold(
                bottomNavigationBar: MobileBottomBar(
                  currentIndex: 0,
                  onTap: (_) {},
                ),
                body: GuardianScenicBackground(
                  child: SingleChildScrollView(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: GuardianOverviewHeader(
                        device: dashboardFixtureDevice(),
                        helpEnabled: true,
                        onCall: () => calls++,
                        onJourney: () {},
                        weather: ProfileWeatherPanel(
                          weather: ProfileWeather.fromMap(
                            weatherTestData(condition: 'thunderstorm'),
                          ),
                          now: weatherTestNow,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.pump();
          expect(find.text('25°C'), findsOneWidget);
          expect(find.text('Near Lower Vale'), findsOneWidget);
          expect(find.text('Weather updated 8m ago'), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.ensureVisible(find.text('Call watch'));
          await tester.tap(find.text('Call watch'));
          expect(calls, 1, reason: 'scenery must not intercept button presses');
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  testWidgets(
    'switching themes updates pushed routes and dialogs without replacing navigator or form state',
    (tester) async {
      final navigatorKey = GlobalKey<NavigatorState>();
      final fieldKey = GlobalKey<FormFieldState<String>>();
      var mounts = 0, disposals = 0;
      late BuildContext routeContext;
      await tester.pumpWidget(
        GuardianAppearanceHost(
          builder: (context, appearance) => MaterialApp(
            navigatorKey: navigatorKey,
            themeAnimationDuration: Duration.zero,
            theme: buildGuardianTheme(themeId: appearance.themeId),
            home: _MountProbe(
              onMount: () => mounts++,
              onDispose: () => disposals++,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final originalNavigator = navigatorKey.currentState;
      originalNavigator!.push(
        MaterialPageRoute<void>(
          builder: (context) {
            routeContext = context;
            return Scaffold(
              body: TextFormField(
                key: fieldKey,
                initialValue: 'Keep this edit',
              ),
            );
          },
        ),
      );
      await tester.pumpAndSettle();
      final originalField = fieldKey.currentState;
      await tester.enterText(find.byType(TextFormField), 'Unsaved family name');
      for (final theme in GuardianThemeId.allThemes) {
        GuardianThemeScope.maybeOf(routeContext)!.setTheme(theme);
        await tester.pumpAndSettle();
        expect(identical(navigatorKey.currentState, originalNavigator), isTrue);
        expect(identical(fieldKey.currentState, originalField), isTrue);
        expect(find.text('Unsaved family name'), findsOneWidget);
        expect(routeContext.guardianColors.accent, theme.semanticColors.accent);
      }
      expect(mounts, 1);
      expect(disposals, 0);
      showThemePickerDialog(routeContext);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Le Morne'));
      await tester.pumpAndSettle();
      final dialogContext = tester.element(find.byType(AlertDialog));
      expect(
        dialogContext.guardianColors.accent,
        GuardianThemeColors.leMorne.accent,
      );
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(fieldKey.currentState!.value, 'Unsaved family name');
      expect(disposals, 0);
    },
  );

  testWidgets(
    'appearance chooser fits a 320px phone at twice normal text size',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(320, 640);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        GuardianAppearanceHost(
          builder: (context, appearance) => MaterialApp(
            theme: buildGuardianTheme(themeId: appearance.themeId),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => showThemePickerDialog(context),
                  child: const Text('Appearance'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Appearance'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Higher contrast'));
      await tester.tap(find.text('Higher contrast'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(
        tester.element(find.byType(AlertDialog)).guardianColors.highContrast,
        isTrue,
      );
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets('sidebar opens the same existing destinations', (tester) async {
    final tabs = <int>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: buildGuardianTheme(themeId: GuardianThemeId.leMorne),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: Row(
            children: [
              MobileBottomBar(vertical: true, currentIndex: 0, onTap: tabs.add),
              const Expanded(child: SizedBox()),
            ],
          ),
        ),
      ),
    );
    for (final label in ['Home', 'Safe zones', 'Alerts', 'Account']) {
      await tester.tap(find.text(label));
    }
    expect(tabs, [0, 1, 4, 5]);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'high contrast removes scenery without changing the chosen place',
    (tester) async {
      for (final theme in GuardianThemeId.allThemes) {
        await tester.pumpWidget(
          MaterialApp(
            theme: buildGuardianTheme(themeId: theme, highContrast: true),
            themeAnimationDuration: Duration.zero,
            home: const Scaffold(
              body: GuardianScenicBackground(child: Text('Reading')),
            ),
          ),
        );
        expect(find.byType(Image), findsNothing);
        final context = tester.element(find.text('Reading'));
        expect(context.guardianColors.accent, theme.semanticColors.accent);
        expect(
          Theme.of(context).extension<GuardianSceneTheme>()!.enabled,
          isFalse,
        );
      }
    },
  );
}

class _MountProbe extends StatefulWidget {
  const _MountProbe({required this.onMount, required this.onDispose});
  final VoidCallback onMount, onDispose;
  @override
  State<_MountProbe> createState() => _MountProbeState();
}

class _MountProbeState extends State<_MountProbe> {
  @override
  void initState() {
    super.initState();
    widget.onMount();
  }

  @override
  void dispose() {
    widget.onDispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const Scaffold(body: Text('Home'));
}

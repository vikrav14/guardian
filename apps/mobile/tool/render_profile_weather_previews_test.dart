// Synthetic weather rendered through the production profile header and panel.
// flutter test tool/render_profile_weather_previews_test.dart \
//   --dart-define=PROFILE_WEATHER_PREVIEWS=true
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/weather/profile_weather.dart';
import 'package:guardian/widgets/dashboard/guardian_overview_header.dart';
import 'package:guardian/widgets/dashboard/profile_weather_panel.dart';

import '../test/support/dashboard_fixture.dart';

const _enabled = bool.fromEnvironment('PROFILE_WEATHER_PREVIEWS');

void main() {
  for (final preview in [
    (
      name: 'profile_weather_desktop_1280',
      width: 1280.0,
      height: 800.0,
      dark: false,
      scale: 1.0,
      contrast: false,
      condition: 'partly_cloudy',
      night: false,
      ageMinutes: 3,
    ),
    (
      name: 'profile_weather_mobile_390',
      width: 390.0,
      height: 1100.0,
      dark: false,
      scale: 1.0,
      contrast: false,
      condition: 'partly_cloudy',
      night: false,
      ageMinutes: 3,
    ),
    (
      name: 'profile_weather_large_text_320',
      width: 320.0,
      height: 1900.0,
      dark: false,
      scale: 2.0,
      contrast: true,
      condition: 'thunderstorm',
      night: false,
      ageMinutes: 15,
    ),
    (
      name: 'profile_weather_dark_390',
      width: 390.0,
      height: 1100.0,
      dark: true,
      scale: 1.0,
      contrast: false,
      condition: 'rain',
      night: false,
      ageMinutes: 3,
    ),
    (
      name: 'profile_weather_night_390',
      width: 390.0,
      height: 1100.0,
      dark: true,
      scale: 1.0,
      contrast: false,
      condition: 'clear',
      night: true,
      ageMinutes: 3,
    ),
    (
      name: 'profile_weather_expired_390',
      width: 390.0,
      height: 1100.0,
      dark: false,
      scale: 1.0,
      contrast: false,
      condition: 'rain',
      night: false,
      ageMinutes: 75,
    ),
  ]) {
    testWidgets('render ${preview.name}', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(preview.width, preview.height);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await _loadFonts(tester);

      final now = DateTime.now().toUtc();
      final key = GlobalKey();
      await tester.pumpWidget(
        _host(
          key: key,
          dark: preview.dark,
          scale: preview.scale,
          contrast: preview.contrast,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Family overview',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              const Text('Sample profile and weather · No live data'),
              const SizedBox(height: 24),
              GuardianOverviewHeader(
                device: dashboardFixtureDevice(now: now, name: 'Alex Morgan'),
                helpEnabled: true,
                onCall: () {},
                onJourney: () {},
                onWatchStatus: () {},
                weather: ProfileWeatherPanel(
                  now: now,
                  weather: _weather(
                    now,
                    condition: preview.condition,
                    night: preview.night,
                    locationAgeMinutes: preview.ageMinutes,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
      await _settleArtwork(tester);
      expect(tester.takeException(), isNull);
      expect(find.text('Watch connected'), findsOneWidget);
      expect(find.byTooltip('Open Guardian help'), findsNothing);
      if (preview.ageMinutes > 60) {
        expect(find.text('Weather unavailable'), findsOneWidget);
        expect(find.byType(WeatherArtwork), findsNothing);
      } else {
        expect(find.byType(WeatherArtwork), findsWidgets);
      }
      await _save(tester, key, preview.name);
      await tester.pumpWidget(const SizedBox());
    }, skip: !_enabled);
  }

  for (final dark in [false, true]) {
    testWidgets('render weather conditions ${dark ? 'dark' : 'light'}', (
      tester,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1120, 1400);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await _loadFonts(tester);
      final now = DateTime.now().toUtc();
      final key = GlobalKey();
      final cases = [
        (label: 'Sunshine', condition: 'clear', night: false, wind: 12.0),
        (
          label: 'Partly cloudy',
          condition: 'partly_cloudy',
          night: false,
          wind: 12.0,
        ),
        (label: 'Overcast', condition: 'cloudy', night: false, wind: 12.0),
        (label: 'Rain and wind', condition: 'rain', night: false, wind: 36.0),
        (
          label: 'Thunderstorms',
          condition: 'thunderstorm',
          night: false,
          wind: 32.0,
        ),
        (label: 'Windy sunshine', condition: 'clear', night: false, wind: 38.0),
        (label: 'Nighttime', condition: 'clear', night: true, wind: 8.0),
        (label: 'Mist', condition: 'mist', night: false, wind: 8.0),
        (label: 'Snow', condition: 'snow', night: false, wind: 15.0),
      ];
      await tester.pumpWidget(
        _host(
          key: key,
          dark: dark,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Profile weather · Sample conditions',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              const Text('Production weather panel · Synthetic data'),
              const SizedBox(height: 24),
              Wrap(
                spacing: 16,
                runSpacing: 24,
                children: [
                  for (final sample in cases)
                    SizedBox(
                      width: 340,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            sample.label,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 8),
                          ProfileWeatherPanel(
                            now: now,
                            weather: _weather(
                              now,
                              condition: sample.condition,
                              night: sample.night,
                              wind: sample.wind,
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(width: 340, child: ProfileWeatherPanel()),
                  const SizedBox(
                    width: 340,
                    child: ProfileWeatherPanel(loading: true),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
      await _settleArtwork(tester);
      expect(tester.takeException(), isNull);
      await _save(tester, key, 'weather_conditions_${dark ? 'dark' : 'light'}');
      await tester.pumpWidget(const SizedBox());
    }, skip: !_enabled);
  }
}

ProfileWeather _weather(
  DateTime now, {
  required String condition,
  bool night = false,
  double wind = 18,
  int locationAgeMinutes = 3,
}) => ProfileWeather.fromMap({
  'schemaVersion': 1,
  'state': 'available',
  'condition': condition,
  'isDay': !night,
  'temperatureC': condition == 'snow'
      ? -2
      : night
      ? 22
      : 26,
  'windKph': wind,
  'gustKph': wind + 8,
  'placeName': 'Sample garden',
  'locationObservedAt': now
      .subtract(Duration(minutes: locationAgeMinutes))
      .toIso8601String(),
  'observedAt': now.subtract(const Duration(minutes: 5)).toIso8601String(),
  'fetchedAt': now.subtract(const Duration(minutes: 1)).toIso8601String(),
  'expiresAt': now.add(const Duration(minutes: 10)).toIso8601String(),
});

Widget _host({
  required GlobalKey key,
  required Widget child,
  bool dark = false,
  double scale = 1,
  bool contrast = false,
}) {
  final colors = contrast
      ? GuardianThemeColors.elderCare
      : dark
      ? GuardianThemeColors.dark
      : GuardianThemeColors.light;
  final brightness = dark ? Brightness.dark : Brightness.light;
  final theme = ThemeData(
    useMaterial3: true,
    fontFamily: 'WeatherPreview',
    brightness: brightness,
    scaffoldBackgroundColor: colors.canvas,
    extensions: [colors],
    colorScheme: ColorScheme.fromSeed(
      seedColor: colors.accent,
      brightness: brightness,
      surface: colors.surface,
    ),
  );
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    theme: theme.copyWith(
      textTheme: theme.textTheme.apply(
        bodyColor: colors.textPrimary,
        displayColor: colors.textPrimary,
      ),
    ),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(scale), highContrast: contrast),
      child: child!,
    ),
    home: Scaffold(
      body: SingleChildScrollView(
        child: RepaintBoundary(
          key: key,
          child: ColoredBox(
            color: colors.canvas,
            child: Padding(padding: const EdgeInsets.all(16), child: child),
          ),
        ),
      ),
    ),
  );
}

Future<void> _loadFonts(WidgetTester tester) async {
  await tester.runAsync(() async {
    final path =
        Platform.environment['DASHBOARD_PREVIEW_FONT'] ??
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    final font = FontLoader('WeatherPreview')
      ..addFont(
        Future.value(ByteData.sublistView(await File(path).readAsBytes())),
      );
    await font.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });
}

Future<void> _settleArtwork(WidgetTester tester) async {
  await tester.runAsync(() async {
    final context = tester.element(find.byType(ProfileWeatherPanel).first);
    await precacheImage(
      const AssetImage('assets/weather/weather_atlas.webp'),
      context,
    );
  });
  await tester.pumpAndSettle();
}

Future<void> _save(WidgetTester tester, GlobalKey key, String name) async {
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (data == null) throw StateError('Weather preview PNG encoding failed');
    final directory = Directory('build/profile-weather-previews');
    await directory.create(recursive: true);
    await File('${directory.path}/$name.png').writeAsBytes(
      data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
    );
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/weather/profile_weather.dart';
import 'package:guardian/widgets/dashboard/guardian_overview_header.dart';
import 'package:guardian/widgets/dashboard/profile_weather_panel.dart';

import 'support/profile_weather_fixture.dart';

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  double width = 390,
  double scale = 1,
  bool dark = false,
  bool highContrast = false,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 1000);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final colors = highContrast
      ? GuardianThemeColors.elderCare
      : dark
      ? GuardianThemeColors.dark
      : GuardianThemeColors.light;
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(
        brightness: dark ? Brightness.dark : Brightness.light,
        extensions: [colors],
      ),
      home: Builder(
        builder: (context) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(scale),
            highContrast: highContrast,
          ),
          child: Scaffold(
            body: SingleChildScrollView(
              child: Padding(padding: const EdgeInsets.all(12), child: child),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'weather shows observation age, place and wind without replacing rain',
    (tester) async {
      final data = weatherTestData(condition: 'rain')
        ..['windKph'] = 35
        ..['locationObservedAt'] = weatherTestNow
            .subtract(const Duration(minutes: 20))
            .toIso8601String();
      await _pump(
        tester,
        ProfileWeatherPanel(
          weather: ProfileWeather.fromMap(data),
          now: weatherTestNow,
        ),
      );
      expect(find.text('25°C'), findsOneWidget);
      expect(find.text('Rain'), findsOneWidget);
      expect(find.text('Near Lower Vale'), findsOneWidget);
      expect(find.text('Last known location · 20m ago'), findsOneWidget);
      expect(find.text('Weather updated 8m ago'), findsOneWidget);
      expect(find.text('Wind 35 km/h · Gusts 25 km/h'), findsOneWidget);
      expect(find.byType(WeatherArtwork), findsNWidgets(2));
      final tooltip = tester.widget<Tooltip>(find.byType(Tooltip));
      expect(tooltip.message, contains('Fetched 2026-09-17T11:59:00.000Z'));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'unavailable, expired and loading show no misleading condition artwork',
    (tester) async {
      for (final sample in [
        const ProfileWeatherPanel(),
        const ProfileWeatherPanel(loading: true),
        ProfileWeatherPanel(
          weather: ProfileWeather.fromMap(weatherTestData()),
          now: weatherTestNow.add(const Duration(hours: 1)),
        ),
      ]) {
        await _pump(tester, sample);
        expect(find.byType(WeatherArtwork), findsNothing);
        expect(find.text('25°C'), findsNothing);
        expect(
          find.text(
            sample.loading ? 'Updating weather…' : 'Weather unavailable',
          ),
          findsOneWidget,
        );
      }
    },
  );

  testWidgets(
    'fresh weather at an older area keeps the location age explicit',
    (tester) async {
      final data = weatherTestData()
        ..['locationObservedAt'] = weatherTestNow
            .subtract(const Duration(minutes: 77, seconds: 42))
            .toIso8601String();
      await _pump(
        tester,
        ProfileWeatherPanel(
          weather: ProfileWeather.fromMap(data),
          now: weatherTestNow,
        ),
        width: 320,
        scale: 2,
      );
      expect(find.text('Last known area · Lower Vale'), findsOneWidget);
      expect(find.text('Location updated 1h 17m ago'), findsOneWidget);
      expect(find.text('Weather updated 8m ago'), findsOneWidget);
      expect(find.text('Near Lower Vale'), findsNothing);
      expect(tester.takeException(), isNull);
      await _pump(
        tester,
        ProfileWeatherPanel(
          weather: ProfileWeather.fromMap(data..['placeName'] = null),
          now: weatherTestNow,
        ),
      );
      expect(find.text('Weather at last known area'), findsOneWidget);
      expect(find.text('Location updated 1h 17m ago'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('unknown day period and missing wind do not invent sun or calm', (
    tester,
  ) async {
    await _pump(
      tester,
      ProfileWeatherPanel(
        weather: ProfileWeather.fromMap(
          weatherTestData(condition: 'clear')
            ..['isDay'] = null
            ..['windKph'] = null,
        ),
        now: weatherTestNow,
      ),
    );
    expect(find.text('Clear skies'), findsOneWidget);
    expect(find.byType(WeatherArtwork), findsNothing);
    expect(find.textContaining('Wind '), findsNothing);
  });

  for (final width in [320.0, 1280.0]) {
    for (final dark in [false, true]) {
      testWidgets(
        'profile weather fits $width px dark $dark at 2× and preserves actions',
        (tester) async {
          final calls = <String>[];
          final device = Device(
            imei: 'sample',
            online: true,
            nickname: 'Alex Morgan With A Long Family Name',
            connectionState: 'live',
            lastHeartbeatAt: DateTime.now(),
            batteryPercent: 82,
            batteryUpdatedAt: DateTime.now(),
          );
          await _pump(
            tester,
            GuardianOverviewHeader(
              device: device,
              helpEnabled: true,
              onCall: () => calls.add('call'),
              onJourney: () => calls.add('journey'),
              onWatchStatus: () => calls.add('watch'),
              onHelp: () => calls.add('help'),
              watchCheckStatus: const Text(
                'Scheduled check · readings received',
              ),
              weather: ProfileWeatherPanel(
                weather: ProfileWeather.fromMap(
                  weatherTestData(condition: 'thunderstorm')
                    ..['placeName'] =
                        'L’Espérance Trébuchet, Rivière du Rempart',
                ),
                now: weatherTestNow,
              ),
            ),
            width: width,
            scale: 2,
            dark: dark,
            highContrast: !dark,
          );
          expect(tester.takeException(), isNull);
          expect(find.text('Thunderstorms'), findsOneWidget);
          expect(
            find.text('Scheduled check · readings received'),
            findsOneWidget,
          );
          expect(find.byIcon(Icons.chat_bubble_outline_rounded), findsNothing);
          for (final label in [
            'Watch connected',
            'Call watch',
            'View journey',
          ]) {
            await tester.ensureVisible(find.text(label));
            await tester.tap(find.text(label));
            await tester.pump();
          }
          expect(calls, ['watch', 'call', 'journey']);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}

import 'dart:async';
import 'dart:ui' as ui;
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/local_updates/priority_update.dart';
import 'package:guardian/local_updates/linked_priority_updates.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/home_wifi_presence.dart';
import 'package:guardian/weather/profile_weather.dart';
import 'package:guardian/widgets/dashboard/profile_weather_panel.dart';
import 'package:guardian/theme/colors.dart';
import 'support/profile_weather_fixture.dart';

final now = weatherTestNow;
String at(int minutes) => now.add(Duration(minutes: minutes)).toIso8601String();
Device wearer({
  String imei = 'watch',
  double lat = -20.028,
  Map<String, bool>? permissions,
}) => Device(
  imei: imei,
  online: true,
  name: 'Jesh',
  sharedPermissions: permissions,
  lastLocationObservation: DeviceLocation(
    lat: lat,
    lng: 57.596,
    source: 'gps',
    recordedAt: now.subtract(const Duration(minutes: 2)),
  ),
);
Map<String, dynamic> projection() => {
  'schemaVersion': 1,
  'location': {
    'lat': -20.028,
    'lng': 57.596,
    'source': 'gps',
    'recordedAt': at(-2),
    'expiresAt': at(13),
  },
  'items': [
    <String, dynamic>{
      'id': 'news-1',
      'revision': 'revision-1',
      'kind': 'local_report',
      'eventType': 'road_disruption',
      'title': 'The Vale : route fermée jusqu’à nouvel ordre',
      'placeName': 'Lower Vale',
      'sourceName': 'Défi Media',
      'sourceUrl': 'https://defimedia.info/example',
      'publishedAt': at(-10),
      'sourceCheckedAt': at(-1),
      'expiresAt': at(13),
      'matchReason':
          'Report from Lower Vale, near the watch’s latest recorded area. The incident’s exact position is not supplied.',
    },
  ],
};
Future<void> flush(WidgetTester tester) async {
  await tester.pump();
  await tester.pump();
}

void main() {
  setUpAll(() async {
    if (Platform.environment['GUARDIAN_RENDER_PRIORITY'] != '1') return;
    final path = Platform.environment['DASHBOARD_PREVIEW_FONT']!;
    final font = FontLoader('PriorityPreview')
      ..addFont(
        Future.value(ByteData.sublistView(await File(path).readAsBytes())),
      );
    await font.load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  test(
    'projection requires matching fresh position and location permission',
    () {
      final data = PriorityUpdates.fromMap(projection());
      expect(data.applicable(wearer(), now), hasLength(1));
      expect(data.applicable(wearer(lat: -20.1), now), isEmpty);
      expect(
        data.applicable(wearer(permissions: {'alerts': true}), now),
        isEmpty,
      );
      expect(
        data.applicable(wearer(), now.add(const Duration(minutes: 13))),
        isEmpty,
      );
      expect(PriorityUpdates.fromMap({}).applicable(wearer(), now), isEmpty);
      for (final changes in [
        {'sourceUrl': 'https://evil.test/story'},
        {'expiresAt': at(0)},
        {'sourceCheckedAt': at(-30)},
        {'sourceCheckedAt': at(2)},
        {'publishedAt': null},
      ]) {
        final map = projection();
        (map['items'] as List).first.addAll(changes);
        expect(PriorityUpdates.fromMap(map).applicable(wearer(), now), isEmpty);
      }
    },
  );

  test('Home evidence prevents redisplaying the old trip after returning', () {
    final trip = wearer().lastLocationObservation;
    final home = HomeWifiPresence(
      lat: -20.05,
      lng: 57.59,
      observedAt: now,
      expiresAt: now.add(const Duration(minutes: 2)),
      policyVersion: 4,
      radiusMeters: 100,
    );
    final device = Device(
      imei: 'watch',
      online: true,
      lastLocationObservation: trip,
      homeWifiPresence: home,
      lastHomeWifiDetection: LastHomeWifiDetection(
        lat: home.lat,
        lng: home.lng,
        observedAt: now,
        qualifiedUntil: now.add(const Duration(minutes: 2)),
      ),
    );
    final old = PriorityUpdates.fromMap(projection());
    expect(old.applicable(device, now), isEmpty);
    expect(
      old.applicable(device, now.add(const Duration(minutes: 3))),
      isEmpty,
    );
    final map = projection()
      ..['location'] = {
        'lat': home.lat,
        'lng': home.lng,
        'source': 'home_wifi',
        'recordedAt': now.toIso8601String(),
        'expiresAt': at(2),
      };
    expect(PriorityUpdates.fromMap(map).applicable(device, now), hasLength(1));
    expect(
      PriorityUpdates.fromMap(
        map,
      ).applicable(device, now.add(const Duration(minutes: 2))),
      isEmpty,
    );
  });

  testWidgets(
    'weather artwork, stable slot, manual shortcut, source details and automatic expiry',
    (tester) async {
      final events = StreamController<Map<String, dynamic>>();
      var clock = now;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 360,
              child: LinkedPriorityUpdates(
                device: wearer(),
                source: (_) => events.stream,
                clock: () => clock,
                temperatureC: 24.5,
                weather: ProfileWeatherPanel(
                  weather: ProfileWeather.fromMap(weatherTestData()),
                  now: now,
                ),
              ),
            ),
          ),
        ),
      );
      expect(find.byType(WeatherArtwork), findsWidgets);
      final before = tester.getSize(
        find.byKey(const ValueKey('priority-slot')),
      );
      events.add(projection());
      await flush(tester);
      expect(find.text('LOCAL REPORT'), findsOneWidget);
      expect(find.byType(WeatherArtwork), findsNothing);
      expect(
        tester.getSize(find.byKey(const ValueKey('priority-slot'))),
        before,
      );
      await tester.tap(find.text('25°C'));
      await tester.pump();
      expect(find.byType(WeatherArtwork), findsWidgets);
      await tester.tap(find.text('Update'));
      await tester.pump();
      await tester.tap(find.text('View update'));
      await tester.pumpAndSettle();
      expect(find.text('Read source report'), findsOneWidget);
      expect(
        find.text(
          'A nearby report does not confirm that the wearer is affected.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      clock = now.add(const Duration(minutes: 14));
      await tester.pump(const Duration(minutes: 14));
      expect(find.text('LOCAL REPORT'), findsNothing);
      expect(find.byType(WeatherArtwork), findsWidgets);
      expect(
        tester.getSize(find.byKey(const ValueKey('priority-slot'))),
        before,
      );
      await tester.pumpWidget(const SizedBox());
      unawaited(events.close());
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'movement, stream errors, permission loss and wearer switch clear the report',
    (tester) async {
      final first = StreamController<Map<String, dynamic>>();
      final second = StreamController<Map<String, dynamic>>();
      Stream<Map<String, dynamic>> source(String id) =>
          id == 'watch' ? first.stream : second.stream;
      Future<void> show(Device device) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LinkedPriorityUpdates(
              device: device,
              source: source,
              clock: () => now,
              weather: const Text('Weather'),
            ),
          ),
        ),
      );
      await show(wearer());
      first.add(projection());
      await flush(tester);
      expect(find.text('LOCAL REPORT'), findsOneWidget);
      await show(wearer(lat: -20.1));
      expect(find.text('LOCAL REPORT'), findsNothing);
      await show(wearer());
      first.addError(StateError('offline'));
      await flush(tester);
      expect(find.text('LOCAL REPORT'), findsNothing);
      first.add(projection());
      await flush(tester);
      await show(wearer(imei: 'second'));
      expect(find.text('LOCAL REPORT'), findsNothing);
      expect(first.hasListener, isFalse);
      first.add(projection());
      await flush(tester);
      expect(find.text('LOCAL REPORT'), findsNothing);
      second.add(projection());
      await flush(tester);
      expect(find.text('LOCAL REPORT'), findsOneWidget);
      // Linked auth listener emits empty data immediately on sign-out/unlink.
      second.add({});
      await flush(tester);
      expect(find.text('LOCAL REPORT'), findsNothing);
      second.add(projection());
      await flush(tester);
      await show(wearer(imei: 'second', permissions: {'alerts': true}));
      expect(find.text('LOCAL REPORT'), findsNothing);
      expect(second.hasListener, isFalse);
      await tester.pumpWidget(const SizedBox());
      unawaited(first.close());
      unawaited(second.close());
    },
  );

  for (final scale in [1.0, 2.0]) {
    for (final dark in [false, true]) {
      testWidgets('priority card at 320px / text $scale / dark $dark', (
        tester,
      ) async {
        final events = StreamController<Map<String, dynamic>>();
        final boundary = GlobalKey();
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(
              fontFamily:
                  Platform.environment['GUARDIAN_RENDER_PRIORITY'] == '1'
                  ? 'PriorityPreview'
                  : null,
              brightness: dark ? Brightness.dark : Brightness.light,
              extensions: [
                dark ? GuardianThemeColors.dark : GuardianThemeColors.light,
              ],
              colorScheme: ColorScheme.fromSeed(
                seedColor: const Color(0xFF287353),
                brightness: dark ? Brightness.dark : Brightness.light,
              ),
            ),
            home: Scaffold(
              body: SingleChildScrollView(
                child: Center(
                  child: SizedBox(
                    width: 320,
                    child: MediaQuery(
                      data: MediaQueryData(
                        textScaler: TextScaler.linear(scale),
                      ),
                      child: RepaintBoundary(
                        key: boundary,
                        child: ColoredBox(
                          color: dark
                              ? const Color(0xFF182D24)
                              : const Color(0xFFF6F8F3),
                          child: LinkedPriorityUpdates(
                            device: wearer(),
                            source: (_) => events.stream,
                            clock: () => now,
                            weather: ProfileWeatherPanel(
                              weather: ProfileWeather.fromMap(
                                weatherTestData(),
                              ),
                              now: now,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        final map = projection();
        (map['items'] as List).add(<String, dynamic>{
          ...((map['items'] as List).first as Map<String, dynamic>),
          'id': 'two',
          'title': 'Another relevant report',
        });
        events.add(map);
        await flush(tester);
        expect(tester.takeException(), isNull);
        if (Platform.environment['GUARDIAN_RENDER_PRIORITY'] == '1' &&
            scale == 1 &&
            !dark) {
          await tester.runAsync(() async {
            final image =
                await (boundary.currentContext!.findRenderObject()
                        as RenderRepaintBoundary)
                    .toImage(pixelRatio: 2);
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            await Directory('build/priority-preview').create(recursive: true);
            await File(
              'build/priority-preview/priority-card.png',
            ).writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }
        await tester.ensureVisible(find.byTooltip('Next update (1 of 2)'));
        await tester.tap(find.byTooltip('Next update (1 of 2)'));
        await tester.pump();
        expect(find.text('Another relevant report'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        unawaited(events.close());
      });
    }
  }
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/weather/linked_profile_weather.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/home_wifi_presence.dart';

import 'support/profile_weather_fixture.dart';

Future<void> _flushWeather(WidgetTester tester) async {
  // Async stream delivery can schedule a rebuild after pump's frame. Flush
  // delivery first, then render that frame before inspecting the widget tree.
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets(
    'returning Home hides trip weather until conditions for the saved pin arrive',
    (tester) async {
      final events = StreamController<Map<String, dynamic>>();
      Stream<Map<String, dynamic>> source(String _) => events.stream;
      var clock = weatherTestNow;
      final observed = clock.subtract(const Duration(seconds: 30));
      final until = clock.add(const Duration(seconds: 90));
      final homeDevice = Device(
        imei: 'sample',
        online: true,
        homeWifiPresence: HomeWifiPresence(
          lat: -20.05,
          lng: 57.59,
          observedAt: observed,
          expiresAt: until,
          policyVersion: 4,
          radiusMeters: 100,
        ),
        lastHomeWifiDetection: LastHomeWifiDetection(
          lat: -20.05,
          lng: 57.59,
          observedAt: observed,
          qualifiedUntil: until,
        ),
      );
      Future<void> show(Device device) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LinkedProfileWeather(
              imei: 'sample',
              device: device,
              source: source,
              clock: () => clock,
            ),
          ),
        ),
      );
      await show(homeDevice);
      events.add(weatherTestData()..['placeName'] = 'Grand Baie');
      await _flushWeather(tester);
      expect(find.text('Near Grand Baie'), findsNothing);
      expect(find.text('Updating weather…'), findsOneWidget);
      events.add(
        weatherTestData()
          ..['placeName'] = 'Home'
          ..['location'] = {'lat': -20.05, 'lng': 57.59, 'source': 'home_wifi'}
          ..['locationBasis'] = 'home_wifi'
          ..['homePresenceExpiresAt'] = until.toIso8601String()
          ..['locationObservedAt'] = observed.toIso8601String(),
      );
      await _flushWeather(tester);
      expect(find.text('Near Home'), findsOneWidget);
      expect(find.text('25°C'), findsOneWidget);
      clock = clock.add(const Duration(minutes: 2));
      await tester.pump(const Duration(minutes: 2));
      expect(find.text('Last known area · Home'), findsOneWidget);
      // Leaving Home cannot keep showing the previous Home projection.
      await show(const Device(imei: 'sample', online: true));
      await _flushWeather(tester);
      expect(find.text('Last known area · Home'), findsNothing);
      expect(find.text('Updating weather…'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      unawaited(events.close());
    },
  );

  testWidgets(
    'switching profiles clears old weather and ignores its later events',
    (tester) async {
      final first = StreamController<Map<String, dynamic>>();
      final second = StreamController<Map<String, dynamic>>();
      Stream<Map<String, dynamic>> source(String imei) =>
          imei == 'first' ? first.stream : second.stream;
      Future<void> show(String imei) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LinkedProfileWeather(
              imei: imei,
              source: source,
              clock: () => weatherTestNow,
            ),
          ),
        ),
      );
      await show('first');
      expect(find.text('Updating weather…'), findsOneWidget);
      first.add(weatherTestData());
      await _flushWeather(tester);
      expect(find.text('Near Lower Vale'), findsOneWidget);
      await show('second');
      expect(first.hasListener, isFalse);
      expect(second.hasListener, isTrue);
      expect(find.text('Near Lower Vale'), findsNothing);
      expect(find.text('Updating weather…'), findsOneWidget);
      first.add(weatherTestData()..['placeName'] = 'Previous profile');
      second.add(weatherTestData()..['placeName'] = 'New profile');
      await _flushWeather(tester);
      expect(find.text('Near Previous profile'), findsNothing);
      expect(find.text('Near New profile'), findsOneWidget);
      second.addError(StateError('permission denied'));
      await _flushWeather(tester);
      expect(find.text('Weather unavailable'), findsOneWidget);
      expect(find.text('Near New profile'), findsNothing);
      second.add(weatherTestData());
      await _flushWeather(tester);
      expect(find.text('Near Lower Vale'), findsOneWidget);
      // The linked auth/membership guard emits an empty map immediately on unlink.
      second.add({});
      await _flushWeather(tester);
      expect(find.text('Near Lower Vale'), findsNothing);
      expect(find.text('Weather unavailable'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      expect(first.hasListener, isFalse);
      expect(second.hasListener, isFalse);
      unawaited(first.close());
      unawaited(second.close());
      await _flushWeather(tester);
      expect(tester.takeException(), isNull);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'cached conditions expire without a further Firestore event',
    (tester) async {
      final events = StreamController<Map<String, dynamic>>();
      var clock = weatherTestNow;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LinkedProfileWeather(
              imei: 'sample',
              source: (_) => events.stream,
              clock: () => clock,
            ),
          ),
        ),
      );
      events.add(
        weatherTestData()
          ..['expiresAt'] = clock
              .add(const Duration(seconds: 10))
              .toIso8601String(),
      );
      await _flushWeather(tester);
      expect(find.text('25°C'), findsOneWidget);
      clock = clock.add(const Duration(seconds: 11));
      await tester.pump(const Duration(seconds: 11));
      expect(find.text('Weather unavailable'), findsOneWidget);
      expect(find.text('25°C'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      expect(events.hasListener, isFalse);
      unawaited(events.close());
      await _flushWeather(tester);
      expect(tester.takeException(), isNull);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'last known area expires at 24h while weather is still fresh',
    (tester) async {
      final events = StreamController<Map<String, dynamic>>();
      var clock = weatherTestNow;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LinkedProfileWeather(
              imei: 'sample',
              source: (_) => events.stream,
              clock: () => clock,
            ),
          ),
        ),
      );
      events.add(
        weatherTestData()
          ..['locationObservedAt'] = clock
              .subtract(const Duration(hours: 23, minutes: 59, seconds: 50))
              .toIso8601String(),
      );
      await _flushWeather(tester);
      expect(find.text('Last known area · Lower Vale'), findsOneWidget);
      expect(find.text('Weather updated 8m ago'), findsOneWidget);
      clock = clock.add(const Duration(seconds: 11));
      await tester.pump(const Duration(seconds: 11));
      expect(find.text('Weather unavailable'), findsOneWidget);
      expect(find.text('25°C'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      expect(events.hasListener, isFalse);
      unawaited(events.close());
      await _flushWeather(tester);
      expect(tester.takeException(), isNull);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}

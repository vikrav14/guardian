import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/weather/linked_profile_weather.dart';

import 'support/profile_weather_fixture.dart';

void main() {
  testWidgets('switching profiles clears old weather and ignores its later events', (tester) async {
    final first = StreamController<Map<String, dynamic>>();
    final second = StreamController<Map<String, dynamic>>();
    Stream<Map<String, dynamic>> source(String imei) => imei == 'first' ? first.stream : second.stream;
    Future<void> show(String imei) => tester.pumpWidget(MaterialApp(
      home: Scaffold(body: LinkedProfileWeather(
        imei: imei, source: source, clock: () => weatherTestNow,
      )),
    ));
    await show('first');
    expect(find.text('Updating weather…'), findsOneWidget);
    first.add(weatherTestData());
    await tester.pump();
    expect(find.text('Near Lower Vale'), findsOneWidget);
    await show('second');
    expect(find.text('Near Lower Vale'), findsNothing);
    expect(find.text('Updating weather…'), findsOneWidget);
    first.add(weatherTestData()..['placeName'] = 'Previous profile');
    second.add(weatherTestData()..['placeName'] = 'New profile');
    await tester.pump();
    expect(find.text('Near Previous profile'), findsNothing);
    expect(find.text('Near New profile'), findsOneWidget);
    second.addError(StateError('permission denied'));
    await tester.pump();
    expect(find.text('Weather unavailable'), findsOneWidget);
    expect(find.text('Near New profile'), findsNothing);
    second.add(weatherTestData());
    await tester.pump();
    expect(find.text('Near Lower Vale'), findsOneWidget);
    // The linked auth/membership guard emits an empty map immediately on unlink.
    second.add({});
    await tester.pump();
    expect(find.text('Near Lower Vale'), findsNothing);
    expect(find.text('Weather unavailable'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    expect(first.hasListener, isFalse);
    expect(second.hasListener, isFalse);
    unawaited(first.close());
    unawaited(second.close());
    await tester.pump();
    expect(tester.takeException(), isNull);
  }, timeout: const Timeout(Duration(seconds: 45)));

  testWidgets('cached conditions expire without a further Firestore event', (tester) async {
    final events = StreamController<Map<String, dynamic>>();
    var clock = weatherTestNow;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: LinkedProfileWeather(
        imei: 'sample', source: (_) => events.stream, clock: () => clock,
      )),
    ));
    events.add(weatherTestData()
      ..['expiresAt'] = clock.add(const Duration(seconds: 10)).toIso8601String());
    await tester.pump();
    expect(find.text('25°C'), findsOneWidget);
    clock = clock.add(const Duration(seconds: 11));
    await tester.pump(const Duration(seconds: 11));
    expect(find.text('Weather unavailable'), findsOneWidget);
    expect(find.text('25°C'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    expect(events.hasListener, isFalse);
    unawaited(events.close());
    await tester.pump();
    expect(tester.takeException(), isNull);
  }, timeout: const Timeout(Duration(seconds: 45)));
}

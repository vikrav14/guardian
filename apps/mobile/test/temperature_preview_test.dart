import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/wellbeing_reading.dart';
import 'package:guardian/services/guardian_services.dart';
import 'package:guardian/wellness/wellness_card.dart';
import 'package:guardian/wellness/wellness_history.dart';
import 'package:guardian/wellness/wellness_sample.dart';
import 'package:guardian/wellness/wellness_window.dart';

void main() {
  final now = DateTime.utc(2026, 8, 25, 14, 5);
  final at = now.subtract(const Duration(minutes: 5));
  Map<String, dynamic> record() => {
    'metricSet': 'skin_temperature',
    'values': {'skinTemperatureCelsius': 34.56},
    'observedAt': at,
    'displayable': false,
    'privatePreviewOnly': true,
    'sourceCommand': 'btemp2',
    'sourceVariant': '1',
  };
  test('compared temperature variant is a private preview with exact decimals', () {
    final reading = WellbeingReading.fromMap(record(), id: 'temp', pilotPreview: true);
    expect(reading.skinTemperatureCelsius, 34.56);
    expect(reading.measurementLabel, '34.56 °C skin temperature estimate');
    expect(reading.displayable, isFalse);
    expect(reading.quality, 'pilot_unverified');
    expect(() => WellbeingReading.fromMap(record(), id: 'temp'), throwsStateError);
  });
  test('wrong variant, malformed values and attempted customer promotion are rejected', () {
    for (final patch in <Map<String, dynamic>>[
      {'displayable': true},
      {'privatePreviewOnly': false},
      {'sourceCommand': 'bodytemp2'},
      {'sourceVariant': '0'},
      {'values': {'skinTemperatureCelsius': '34.56'}},
      {'values': {'skinTemperatureCelsius': double.nan}},
      {'values': {'skinTemperatureCelsius': double.infinity}},
      {'values': {'skinTemperatureCelsius': 0}},
      {'values': {'skinTemperatureCelsius': 99.99}},
      {'values': {'skinTemperatureCelsius': 34.567}},
    ]) {
      expect(() => WellbeingReading.fromMap({...record(), ...patch},
          id: 'temp', pilotPreview: true), throwsStateError);
    }
  });
  testWidgets('temperature card uses its own receipt age and filters dates and errors', (tester) async {
    Future<void> show({bool preview = true, bool error = false}) => tester.pumpWidget(
      MaterialApp(home: Scaffold(body: SingleChildScrollView(child: WellnessCard(
        now: now, days: const [], pilotPreview: preview,
        readingsAvailable: true, readingsError: error,
        samples: [
          WellnessSample(metric: WellnessMetric.skinTemperature, value: '34.56 °C', recordedAt: at),
          WellnessSample(metric: WellnessMetric.skinTemperature, value: '33.21 °C', recordedAt: now.subtract(const Duration(days: 1))),
          WellnessSample(metric: WellnessMetric.skinTemperature, value: '35.12 °C', recordedAt: now.add(const Duration(minutes: 1))),
        ],
      )))),
    );
    await show();
    expect(find.text('34.56 °C'), findsOneWidget);
    expect(find.text('Received 5m ago'), findsOneWidget);
    expect(find.text('33.21 °C'), findsNothing);
    expect(find.text('35.12 °C'), findsNothing);
    expect(find.text('— bpm'), findsOneWidget);
    await show(preview: false);
    expect(find.text('34.56 °C'), findsNothing);
    expect(find.text('Not available yet'), findsOneWidget);
    await show(error: true);
    expect(find.text('34.56 °C'), findsNothing);
    expect(find.text('— °C'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('history includes temperature only in private preview', (tester) async {
    final subscription = GuardianSubscription.fromMap({
      'version': 1, 'managedBy': 'guardian_admin', 'status': 'active', 'plan': 'family',
    });
    Future<void> show(bool preview) => tester.pumpWidget(MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: WellnessHistory(
        window: WellnessWindow.forSubscription(subscription, now: now),
        days: const [], now: now, readingsAvailable: true, pilotPreview: preview,
        samples: [WellnessSample(metric: WellnessMetric.skinTemperature,
          value: '34.56 °C', recordedAt: at)],
      ))),
    ));
    await show(true);
    expect(find.textContaining('Skin temperature · received · 34.56 °C'), findsOneWidget);
    await show(false);
    expect(find.textContaining('34.56 °C'), findsNothing);
    expect(tester.takeException(), isNull);
  });
  for (final preview in [true, false]) {
    test('Firestore stream temperature access with pilot preview $preview', () async {
      // A fresh auth stream per mode models independent subscriptions and avoids
      // relying on replay behavior of a cancelled mock auth stream.
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'pilot'), signedIn: true);
      await db.collection('users').doc('pilot').set({'linkedImeis': ['watch']});
      final readings = db.collection('devices').doc('watch').collection('wellbeingReadings');
      final recent = DateTime.now().subtract(const Duration(seconds: 1));
      await readings.doc('temp').set({...record(), 'observedAt': Timestamp.fromDate(recent)});
      await readings.doc('oxygen').set({'metricSet': 'spo2', 'displayable': true,
        'values': {'spo2Percent': 97}, 'observedAt': Timestamp.fromDate(recent)});
      final subscription = GuardianSubscription.fromMap({
        'version': 1, 'managedBy': 'guardian_admin', 'status': 'active', 'plan': 'family',
      });
      final service = WellbeingService(db: db, auth: auth);
      final window = WellnessWindow.forSubscription(subscription, now: DateTime.now());
      final samples = await service.watchWellnessSamples('watch', subscription: subscription,
        window: window, pilotPreview: preview).firstWhere((v) => v.isNotEmpty)
          .timeout(const Duration(seconds: 5));
      expect(samples.map((v) => v.value),
          unorderedEquals(preview ? ['34.56 °C', '97 %'] : ['97 %']));
    });
  }
}

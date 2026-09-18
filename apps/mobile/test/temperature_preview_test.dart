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
  Map<String, dynamic> record({bool displayable = false}) => {
    'metricSet': 'skin_temperature',
    'values': {'skinTemperatureCelsius': 34.56},
    'observedAt': at,
    'displayable': displayable,
    'quality': 'transport_valid_unverified',
    'sourceCommand': 'btemp2',
    'sourceVariant': '1',
  };

  test('supported temperature estimates preserve exact decimals', () {
    final reading = WellbeingReading.fromMap(record(), id: 'temp');
    expect(reading.skinTemperatureCelsius, 34.56);
    expect(reading.measurementLabel, '34.56 °C skin temperature estimate');
    expect(reading.displayable, isFalse);
    expect(reading.quality, 'transport_valid_unverified');
    expect(
      WellbeingReading.fromMap(
        record(displayable: true),
        id: 'customer',
      ).displayable,
      isTrue,
    );
  });

  test('wrong source shapes and malformed values are rejected', () {
    for (final patch in <Map<String, dynamic>>[
      {'sourceCommand': 'bodytemp2'},
      {'sourceVariant': '0'},
      {
        'values': {'skinTemperatureCelsius': '34.56'},
      },
      {
        'values': {'skinTemperatureCelsius': double.nan},
      },
      {
        'values': {'skinTemperatureCelsius': double.infinity},
      },
      {
        'values': {'skinTemperatureCelsius': 0},
      },
      {
        'values': {'skinTemperatureCelsius': 99.99},
      },
      {
        'values': {'skinTemperatureCelsius': 34.567},
      },
    ]) {
      expect(
        () => WellbeingReading.fromMap({...record(), ...patch}, id: 'temp'),
        throwsStateError,
      );
    }
  });

  testWidgets('temperature card uses receipt age on the standard app surface', (
    tester,
  ) async {
    Future<void> show({bool available = true, bool error = false}) =>
        tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: WellnessCard(
                  now: now,
                  days: const [],
                  readingsAvailable: available,
                  readingsError: error,
                  samples: [
                    WellnessSample(
                      metric: WellnessMetric.skinTemperature,
                      value: '34.56 °C',
                      recordedAt: at,
                    ),
                    WellnessSample(
                      metric: WellnessMetric.skinTemperature,
                      value: '33.21 °C',
                      recordedAt: now.subtract(const Duration(days: 1)),
                    ),
                    WellnessSample(
                      metric: WellnessMetric.skinTemperature,
                      value: '35.12 °C',
                      recordedAt: now.add(const Duration(minutes: 1)),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
    await show();
    expect(find.text('34.56 °C'), findsOneWidget);
    expect(find.text('Received 5m ago'), findsOneWidget);
    expect(find.text('33.21 °C'), findsNothing);
    expect(find.text('35.12 °C'), findsNothing);
    expect(find.text('— bpm'), findsOneWidget);
    await show(available: false);
    expect(find.text('34.56 °C'), findsNothing);
    expect(find.text('Not available yet'), findsNWidgets(4));
    await show(error: true);
    expect(find.text('34.56 °C'), findsNothing);
    expect(find.text('— °C'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Care history includes temperature as a normal estimate', (
    tester,
  ) async {
    final subscription = GuardianSubscription.fromMap({
      'version': 1,
      'managedBy': 'guardian_admin',
      'status': 'active',
      'plan': 'care',
    });
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WellnessHistory(
              window: WellnessWindow.forSubscription(subscription, now: now),
              days: const [],
              now: now,
              readingsAvailable: true,
              samples: [
                WellnessSample(
                  metric: WellnessMetric.skinTemperature,
                  value: '34.56 °C',
                  recordedAt: at,
                ),
              ],
            ),
          ),
        ),
      ),
    );
    expect(find.text('34.56 °C'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('wellness-metric-skinTemperature')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Skin temperature over time'), findsOneWidget);
    expect(find.textContaining('Received ·'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('Care stream includes temperature alongside optical readings', () async {
    final db = FakeFirebaseFirestore();
    final auth = MockFirebaseAuth(
      mockUser: MockUser(uid: 'care'),
      signedIn: true,
    );
    await db.collection('users').doc('care').set({
      'linkedImeis': ['watch'],
    });
    final readings = db
        .collection('devices')
        .doc('watch')
        .collection('wellbeingReadings');
    final recent = DateTime.now().subtract(const Duration(seconds: 1));
    await readings.doc('temp').set({
      ...record(displayable: true),
      'observedAt': Timestamp.fromDate(recent),
    });
    await readings.doc('oxygen').set({
      'metricSet': 'spo2',
      'displayable': true,
      'quality': 'transport_valid_unverified',
      'values': {'spo2Percent': 97},
      'observedAt': Timestamp.fromDate(recent),
    });
    await readings.doc('heart').set({
      'metricSet': 'heart_rate_blood_pressure',
      'displayable': true,
      'quality': 'transport_valid_unverified',
      'values': {'heartRateBpm': 72, 'systolicMmHg': 118, 'diastolicMmHg': 76},
      'observedAt': Timestamp.fromDate(recent),
    });
    final subscription = GuardianSubscription.fromMap({
      'version': 1,
      'managedBy': 'guardian_admin',
      'status': 'active',
      'plan': 'care',
    });
    final service = WellbeingService(db: db, auth: auth);
    final window = WellnessWindow.forSubscription(
      subscription,
      now: DateTime.now(),
    );
    final samples = await service
        .watchWellnessSamples(
          'watch',
          subscription: subscription,
          window: window,
        )
        .firstWhere((v) => v.isNotEmpty)
        .timeout(const Duration(seconds: 5));
    expect(
      samples.map((v) => v.value),
      unorderedEquals(['34.56 °C', '97 %', '72 bpm', '118/76 mmHg']),
    );
  });
}

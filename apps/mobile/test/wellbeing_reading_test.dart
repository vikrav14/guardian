import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/wellbeing_reading.dart';

void main() {
  test('parses accepted oxygen and heart/BP readings without interpretation', () async {
    final db = FakeFirebaseFirestore();
    final collection = db
        .collection('devices')
        .doc('AAA')
        .collection('wellbeingReadings');
    await collection.doc('oxygen').set({
      'metricSet': 'spo2',
      'values': {'spo2Percent': 98},
      'quality': 'device_accepted',
      'displayable': true,
      'observedAt': Timestamp.fromDate(DateTime.utc(2026, 8, 23, 14)),
    });
    await collection.doc('heart').set({
      'metricSet': 'heart_rate_blood_pressure',
      'values': {
        'heartRateBpm': 72,
        'systolicMmHg': 120,
        'diastolicMmHg': 72,
      },
      'quality': 'device_accepted',
      'displayable': true,
      'observedAt': Timestamp.fromDate(DateTime.utc(2026, 8, 23, 14, 1)),
    });

    final oxygen = WellbeingReading.fromDoc(await collection.doc('oxygen').get());
    final heart = WellbeingReading.fromDoc(await collection.doc('heart').get());
    expect(oxygen.measurementLabel, '98% oxygen estimate');
    expect(heart.measurementLabel, '72 bpm · 120/72 mmHg');
  });

  test('refuses protected or incomplete wellbeing evidence', () async {
    final db = FakeFirebaseFirestore();
    final collection = db
        .collection('devices')
        .doc('AAA')
        .collection('wellbeingReadings');
    await collection.doc('shadow').set({
      'metricSet': 'spo2',
      'values': {'spo2Percent': 98},
      'displayable': false,
      'observedAt': Timestamp.now(),
    });
    await collection.doc('incomplete').set({
      'metricSet': 'heart_rate_blood_pressure',
      'values': {'heartRateBpm': 72},
      'displayable': true,
      'observedAt': Timestamp.now(),
    });

    expect(
      () async => WellbeingReading.fromDoc(await collection.doc('shadow').get()),
      throwsStateError,
    );
    expect(
      () async => WellbeingReading.fromDoc(await collection.doc('incomplete').get()),
      throwsStateError,
    );
  });
}

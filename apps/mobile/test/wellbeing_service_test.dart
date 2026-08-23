import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/services/guardian_services.dart';

GuardianSubscription plan(String value) => GuardianSubscription.fromMap({
  'version': 1,
  'managedBy': 'guardian_admin',
  'plan': value,
  'status': 'active',
});

void main() {
  test('Care service streams only displayable readings newest first', () async {
    final db = FakeFirebaseFirestore();
    final readings = db
        .collection('devices')
        .doc('AAA')
        .collection('wellbeingReadings');
    Future<void> add(String id, bool displayable, int minute) => readings.doc(id).set({
      'metricSet': 'spo2',
      'values': {'spo2Percent': 98},
      'quality': displayable ? 'device_accepted' : 'transport_valid_unverified',
      'displayable': displayable,
      'observedAt': Timestamp.fromDate(DateTime.utc(2026, 8, 23, 14, minute)),
    });
    await add('older', true, 1);
    await add('newer', true, 2);
    await add('shadow', false, 3);

    final result = await WellbeingService(db: db)
        .watchRecentReadings('AAA', subscription: plan('care'))
        .first;
    expect(result.map((reading) => reading.id), ['newer', 'older']);
  });

  test('Family cannot initialize the Care wellbeing stream', () {
    expect(
      () => WellbeingService(db: FakeFirebaseFirestore())
          .watchRecentReadings('AAA', subscription: plan('family')),
      throwsStateError,
    );
  });
}

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_services.dart';

GuardianSubscription plan(String value, {String status = 'active'}) =>
    GuardianSubscription.fromMap({
      'version': 1,
      'managedBy': 'guardian_admin',
      'plan': value,
      'status': status,
    });

void main() {
  final now = DateTime.utc(2026, 9, 14, 12);
  test(
    'Care streams customer estimates within its calendar window',
    () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'owner'),
        signedIn: true,
      );
      await db.collection('users').doc('owner').set({
        'linkedImeis': ['AAA'],
      });
      final readings = db
          .collection('devices')
          .doc('AAA')
          .collection('wellbeingReadings');
      Future<void> add(String id, DateTime time, {bool displayable = true}) =>
          readings.doc(id).set({
            'metricSet': 'spo2',
            'values': {'spo2Percent': 98},
            'quality': displayable
                ? 'device_accepted'
                : 'transport_valid_unverified',
            'displayable': displayable,
            'observedAt': Timestamp.fromDate(time),
          });
      await add('today', now.subtract(const Duration(minutes: 5)));
      await add('yesterday', now.subtract(const Duration(days: 1)));
      await add('lastMonth', now.subtract(const Duration(days: 30)));
      await add('future', now.add(const Duration(hours: 1)));
      await add('shadow', now, displayable: false);
      final result = await WellbeingService(db: db, auth: auth)
          .watchRecentReadings('AAA', subscription: plan('care'), now: now)
          .firstWhere((values) => values.isNotEmpty);
      expect(
        result.map((reading) => reading.id),
        ['shadow', 'today', 'yesterday'],
      );
    },
  );
  for (final edition in ['essential', 'family']) {
    test('$edition cannot initialize wellbeing readings', () async {
      final service = WellbeingService(
        db: FakeFirebaseFirestore(),
        auth: MockFirebaseAuth(),
      );
      await expectLater(
        service.watchRecentReadings(
          'AAA',
          subscription: plan(edition),
          now: now,
        ),
        emitsError(isA<StateError>()),
      );
    });
  }
  test(
    'inactive subscription cannot initialize the wellbeing source',
    () async {
      final service = WellbeingService(
        db: FakeFirebaseFirestore(),
        auth: MockFirebaseAuth(),
      );
      await expectLater(
        service.watchRecentReadings(
          'AAA',
          subscription: plan('care', status: 'expired'),
          now: now,
        ),
        emitsError(isA<StateError>()),
      );
    },
  );
}

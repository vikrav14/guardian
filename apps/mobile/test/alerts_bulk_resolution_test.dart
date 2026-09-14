import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/services/guardian_services.dart';

GuardianAlert _selected(String id, {String imei = 'watch-a'}) => GuardianAlert(
  id: id,
  imei: imei,
  type: 'sos',
  severity: 'critical',
  message: 'Synthetic incident',
  resolved: false,
);

void main() {
  late FakeFirebaseFirestore db;
  late MockFirebaseAuth auth;
  late AlertService service;
  final originalTime = Timestamp.fromDate(DateTime.utc(2026, 9, 1));
  final evidence = {
    'version': 1,
    'policy': 'map_retained_satellite_v1',
    'capturedAt': originalTime,
    'location': {'lat': -20.25, 'lng': 57.5, 'source': 'gps'},
  };

  setUp(() async {
    db = FakeFirebaseFirestore();
    auth = MockFirebaseAuth(
      mockUser: MockUser(uid: 'guardian'),
      signedIn: true,
    );
    service = AlertService(db: db, auth: auth);
    await db.collection('users').doc('guardian').set({
      'linkedImeis': ['watch-a', 'watch-b'],
    });
    for (final id in ['selected', 'other', 'already-resolved']) {
      await db.collection('alerts').doc(id).set({
        'imei': 'watch-a',
        'type': 'sos',
        'message': 'Synthetic incident',
        'severity': 'critical',
        'createdAt': originalTime,
        'notifyStatus': 'sent',
        'sosLocationSnapshot': evidence,
        'resolved': id == 'already-resolved',
        if (id == 'already-resolved') 'resolvedAt': originalTime,
      });
    }
  });

  test(
    'bulk resolution changes only selected open records and resolution fields',
    () async {
      final ref = db.collection('alerts').doc('selected');
      final before = (await ref.get()).data()!;
      final count = await service.resolveMany([
        _selected('selected'),
        _selected('selected'),
        _selected('already-resolved'),
      ]);
      expect(count, 1);
      final after = (await ref.get()).data()!;
      expect(after['resolved'], isTrue);
      expect(after['resolvedAt'], isA<Timestamp>());
      for (final key in before.keys.where((key) => key != 'resolved')) {
        expect(after[key], before[key], reason: '$key must remain unchanged');
      }
      expect(after.keys.toSet(), {...before.keys, 'resolvedAt'});
      expect(
        (await db.collection('alerts').doc('other').get()).data()!['resolved'],
        isFalse,
      );
      expect(
        (await db.collection('alerts').doc('already-resolved').get())
            .data()!['resolvedAt'],
        originalTime,
      );
    },
  );

  test(
    'a stale selection does not overwrite another guardian resolution time',
    () async {
      expect(await service.resolveMany([_selected('already-resolved')]), 0);
      expect(
        (await db.collection('alerts').doc('already-resolved').get())
            .data()!['resolvedAt'],
        originalTime,
      );
    },
  );

  test('lost watch linkage rejects the whole group before writes', () async {
    await db.collection('users').doc('guardian').update({
      'linkedImeis': ['watch-b'],
    });
    await expectLater(
      service.resolveMany([_selected('selected'), _selected('other')]),
      throwsStateError,
    );
    expect(
      (await db.collection('alerts').doc('selected').get()).data()!['resolved'],
      isFalse,
    );
    expect(
      (await db.collection('alerts').doc('other').get()).data()!['resolved'],
      isFalse,
    );
  });

  test(
    'changed incident identity rejects the whole group before writes',
    () async {
      await db.collection('alerts').doc('other').update({'imei': 'watch-b'});
      await expectLater(
        service.resolveMany([_selected('selected'), _selected('other')]),
        throwsStateError,
      );
      expect(
        (await db.collection('alerts').doc('selected').get())
            .data()!['resolved'],
        isFalse,
      );
      expect(
        (await db.collection('alerts').doc('other').get()).data()!['resolved'],
        isFalse,
      );
    },
  );

  test(
    'empty input is a no-op and selections above the existing 100 limit fail',
    () async {
      expect(await service.resolveMany([]), 0);
      await expectLater(
        service.resolveMany(
          List.generate(101, (i) => _selected('incident-$i')),
        ),
        throwsArgumentError,
      );
    },
  );

  test('bulk resolution requires a signed-in guardian', () async {
    final signedOut = AlertService(
      db: db,
      auth: MockFirebaseAuth(signedIn: false),
    );
    await expectLater(
      signedOut.resolveMany([_selected('selected')]),
      throwsStateError,
    );
  });
}

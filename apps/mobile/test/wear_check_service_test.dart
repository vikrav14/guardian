import 'dart:async';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/wear_check.dart';
import 'package:guardian/services/wear_check_service.dart';

void main() {
  test('a saved check is separate from sensor evidence and disappears on unlink', () async {
    final db = FakeFirebaseFirestore();
    final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'owner'), signedIn: true);
    await db.collection('users').doc('owner').set({'linkedImeis': ['watch-a']});
    final service = WearCheckService(db: db, auth: auth);
    await service.record('watch-a', 'worn');
    final ref = db.collection('devices').doc('watch-a');
    final data = (await ref.collection('wearChecks').doc('current').get()).data()!;
    expect(data['recordedBy'], 'owner');
    expect(WearCheck.fromMap(data)?.state, 'worn');
    expect((await ref.collection('wearStatus').doc('current').get()).exists, false);
    final received = Completer<void>();
    final cleared = Completer<void>();
    final sub = service.watch('watch-a').listen((check) {
      if (check != null && !received.isCompleted) received.complete();
      if (check == null && received.isCompleted && !cleared.isCompleted) cleared.complete();
    });
    await received.future.timeout(const Duration(seconds: 5));
    await db.collection('users').doc('owner').update({'linkedImeis': []});
    await cleared.future.timeout(const Duration(seconds: 5));
    await auth.signOut();
    await expectLater(service.record('watch-a', 'worn'), throwsStateError);
    await sub.cancel();
  });
}

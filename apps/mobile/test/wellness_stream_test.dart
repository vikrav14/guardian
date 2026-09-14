import 'dart:async';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/wellness/linked_wellness_stream.dart';

void main() {
  test(
    'unlink and sign-out clear existing wellness evidence and cancel its source',
    () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'owner'),
        signedIn: true,
      );
      await db.collection('users').doc('owner').set({
        'linkedImeis': ['watch-a'],
      });
      var cancelled = 0;
      var sawReading = false;
      final received = Completer<void>();
      final cleared = Completer<void>();
      final source = StreamController<List<int>>(onCancel: () => cancelled++);
      final stream = watchLinkedWellnessData(
        db,
        auth,
        'watch-a',
        () => source.stream,
      );
      final sub = stream.listen((values) {
        if (values.isNotEmpty) {
          sawReading = true;
          if (!received.isCompleted) received.complete();
        } else if (sawReading && !cleared.isCompleted) {
          cleared.complete();
        }
      });
      source.add([72]);
      await received.future.timeout(const Duration(seconds: 5));
      await db.collection('users').doc('owner').update({'linkedImeis': []});
      await cleared.future.timeout(const Duration(seconds: 5));
      await auth.signOut();
      await sub.cancel();
      await source.close();
      expect(cancelled, 1);
    },
  );
}

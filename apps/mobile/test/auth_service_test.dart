import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/auth_service.dart';
import 'package:guardian/services/push_service.dart';

void main() {
  group('AuthService.sendPasswordResetEmail', () {
    test('completes without throwing for a valid email', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth();
      final service = AuthService(auth: auth, db: db, push: PushService(db: db));

      await expectLater(
        service.sendPasswordResetEmail('  guardian@example.com  '),
        completes,
      );
    });
  });

  group('AuthService.ensureUserProfile', () {
    test('creates a users/{uid} profile with no linked pendants for a new user', () async {
      final db = FakeFirebaseFirestore();
      final user = MockUser(uid: 'u1', email: 'guardian@example.com', displayName: 'Vik');
      final auth = MockFirebaseAuth(mockUser: user, signedIn: true);
      final service = AuthService(auth: auth, db: db, push: PushService(db: db));

      await service.ensureUserProfile(user);

      final doc = await db.collection('users').doc('u1').get();
      expect(doc.exists, true);
      expect(doc.data()!['displayName'], 'Vik');
      expect(doc.data()!['linkedImeis'], isEmpty);
      expect(doc.data()!['role'], 'guardian');
    });

    test('is a no-op for a user that already has a profile', () async {
      final db = FakeFirebaseFirestore();
      final user = MockUser(uid: 'u1', email: 'guardian@example.com');
      final auth = MockFirebaseAuth(mockUser: user, signedIn: true);
      await db.collection('users').doc('u1').set({
        'displayName': 'Existing',
        'linkedImeis': ['CUSTOM123'],
      });
      final service = AuthService(auth: auth, db: db, push: PushService(db: db));

      await service.ensureUserProfile(user);

      final doc = await db.collection('users').doc('u1').get();
      expect(doc.data()!['displayName'], 'Existing');
      expect(doc.data()!['linkedImeis'], ['CUSTOM123']);
    });
  });
}

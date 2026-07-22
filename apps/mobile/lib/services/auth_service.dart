import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'push_service.dart';

class AuthService {
  AuthService({FirebaseAuth? auth, FirebaseFirestore? db, PushService? push})
      : _auth = auth ?? FirebaseAuth.instance,
        _db = db ?? FirebaseFirestore.instance,
        _push = push ?? PushService();

  final FirebaseAuth _auth;
  final FirebaseFirestore _db;
  final PushService _push;

  /// Legacy demo IMEI used by `npm run simulate` in older dev setups.
  /// New accounts start with no linked pendants — link the real 15-digit IMEI
  /// after onboarding hardware.
  static const demoImei = '359633100123456';

  Stream<User?> authStateChanges() => _auth.authStateChanges();

  User? get currentUser => _auth.currentUser;

  Future<UserCredential> signIn({
    required String email,
    required String password,
  }) {
    return _auth.signInWithEmailAndPassword(email: email, password: password);
  }

  Future<void> sendPasswordResetEmail(String email) {
    return _auth.sendPasswordResetEmail(email: email.trim());
  }

  Future<UserCredential> register({
    required String email,
    required String password,
    String? displayName,
  }) async {
    final cred = await _auth.createUserWithEmailAndPassword(
      email: email,
      password: password,
    );
    if (displayName != null && displayName.trim().isNotEmpty) {
      await cred.user?.updateDisplayName(displayName.trim());
    }
    await ensureUserProfile(cred.user!);
    return cred;
  }

  Future<void> signOut() async {
    final uid = _auth.currentUser?.uid;
    if (uid != null) {
      await _push.unregisterForUser(uid);
    }
    await _auth.signOut();
  }

  Future<void> ensureUserProfile(User user) async {
    final ref = _db.collection('users').doc(user.uid);
    final snap = await ref.get();
    if (snap.exists) return;

    await ref.set({
      'displayName': user.displayName ?? user.email ?? 'Guardian',
      'email': user.email,
      'phone': '',
      'role': 'guardian',
      'linkedImeis': <String>[],
      'emergencyContacts': <Map<String, dynamic>>[],
      'familyMembers': <Map<String, dynamic>>[],
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}

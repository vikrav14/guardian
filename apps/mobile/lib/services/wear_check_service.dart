import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/wear_check.dart';
import '../wellness/linked_wellness_stream.dart';

class WearCheckService {
  WearCheckService({FirebaseFirestore? db, FirebaseAuth? auth})
    : _db = db ?? FirebaseFirestore.instance,
      _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  DocumentReference<Map<String, dynamic>> _ref(String imei) => _db
      .collection('devices')
      .doc(imei)
      .collection('wearChecks')
      .doc('current');

  Stream<WearCheck?> watch(String imei) => watchLinkedWellnessData<WearCheck>(
    _db,
    _auth,
    imei,
    () => _ref(imei).snapshots(includeMetadataChanges: true).map((snapshot) {
      // A local write is not a saved family check until the server accepts it.
      final check = snapshot.metadata.hasPendingWrites
          ? null
          : WearCheck.fromMap(snapshot.data());
      return [?check];
    }),
  ).map((checks) => checks.firstOrNull);

  Future<void> record(String imei, String state) async {
    if (!['worn', 'removed'].contains(state)) {
      throw ArgumentError.value(state, 'state');
    }
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Sign in to record a family check');
    final observedAt = Timestamp.fromDate(DateTime.now().toUtc());
    final ref = _ref(imei);
    // Transactions require a server connection; an offline check must never
    // queue and later appear to have been performed at reconnection time.
    await _db.runTransaction((transaction) async {
      await transaction.get(ref);
      if (_auth.currentUser?.uid != uid) throw StateError('Account changed');
      transaction.set(ref, {
        'version': 1,
        'state': state,
        'observedAt': observedAt,
        'recordedAt': FieldValue.serverTimestamp(),
        'recordedBy': uid,
      });
    });
  }
}

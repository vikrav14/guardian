import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/wear_status.dart';
import '../wellness/linked_wellness_stream.dart';

class WearStatusService {
  WearStatusService({FirebaseFirestore? db, FirebaseAuth? auth})
    : _db = db ?? FirebaseFirestore.instance,
      _auth = auth ?? FirebaseAuth.instance;
  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  Stream<WearStatus> watch(String imei) => watchLinkedWellnessData<WearStatus>(
    _db, _auth, imei,
    () => _db.collection('devices').doc(imei).collection('wearStatus')
      .doc('current').snapshots().map((snap) => [
        if (snap.exists) WearStatus.fromMap(snap.data()!),
      ]),
  ).map((values) => values.firstOrNull ?? const WearStatus());
}

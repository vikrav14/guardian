import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/safety_snapshot.dart';

const bool guardianSafetySnapshotsEnabled = bool.fromEnvironment(
  'GUARDIAN_SAFETY_SNAPSHOTS_ENABLED',
  defaultValue: false,
);

class SafetySnapshotService {
  SafetySnapshotService({FirebaseFirestore? db})
    : _db = db ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  Stream<List<SafetySnapshot>> watchSnapshots(String imei) {
    if (!guardianSafetySnapshotsEnabled) {
      return Stream.value(const <SafetySnapshot>[]);
    }
    return _db
        .collection('safetySnapshotAuthorizations')
        .where('imei', isEqualTo: imei)
        .snapshots()
        .map((snapshot) {
          final items = snapshot.docs
              .map((doc) => SafetySnapshot.fromFirestore(doc.id, doc.data()))
              .toList();
          items.sort((a, b) {
            final left = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
            final right = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
            return right.compareTo(left);
          });
          return items;
        });
  }

  Future<void> requestSnapshot() async {
    throw StateError(
      'Safety snapshot requests remain unavailable until exact V52 capture '
      'behaviour, wearer indication, privacy review and backend ingress are accepted.',
    );
  }
}

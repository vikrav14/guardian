import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/removal_alert_state.dart';
import 'backbones/removal_alerts_backbone.dart';

class RemovalAlertsService {
  RemovalAlertsService({FirebaseFirestore? db})
    : _db = db ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  Stream<RemovalAlertState?> watchState(String imei) {
    if (!RemovalAlertsBackbone.customerBuildEnabled) {
      return Stream<RemovalAlertState?>.value(null);
    }
    return _db
        .collection('devices')
        .doc(imei)
        .collection('safetyStates')
        .doc('watchRemoval')
        .snapshots()
        .map((snapshot) {
          if (!snapshot.exists) return null;
          final state = RemovalAlertState.fromMap(snapshot.data());
          return state.customerSafe ? state : null;
        });
  }

  Stream<List<RemovalAlertAuditEvent>> watchHistory(
    String imei, {
    int limit = 30,
  }) {
    if (!RemovalAlertsBackbone.customerBuildEnabled) {
      return Stream<List<RemovalAlertAuditEvent>>.value(
        const <RemovalAlertAuditEvent>[],
      );
    }
    return _db
        .collection('removalAlertAudit')
        .where('imei', isEqualTo: imei)
        .orderBy('eventAt', descending: true)
        .limit(limit)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map(RemovalAlertAuditEvent.fromDoc)
              .toList(growable: false),
        );
  }
}

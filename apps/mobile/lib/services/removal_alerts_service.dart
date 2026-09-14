import 'dart:async';
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
    return Stream<RemovalAlertState?>.multi((controller) {
      RemovalAlertState? latest;
      final subscription = _db.collection('devices').doc(imei)
          .collection('safetyStates').doc('watchRemoval').snapshots().listen(
        (snapshot) {
          latest = snapshot.exists ? RemovalAlertState.fromMap(snapshot.data()) : null;
          controller.add(latest?.customerSafe == true ? latest : null);
        }, onError: (Object error, StackTrace stack) {
          latest = null;
          controller.add(null);
          controller.addError(error, stack);
        },
      );
      final timer = Timer.periodic(const Duration(seconds: 30), (_) {
        if (latest != null && !latest!.customerSafe) {
          latest = null;
          controller.add(null);
        }
      });
      controller.onCancel = () async {
        timer.cancel();
        await subscription.cancel();
      };
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

import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/device.dart';
import 'imei_utils.dart';
import 'guardian_entitlements.dart';

/// Backend-owned grants select streams. Firestore rules independently validate
/// every read against the current service, including revocation and expiry.
Stream<List<Device>> sharedDeviceStream(
  FirebaseFirestore db,
  FirebaseAuth auth,
) {
  final uid = auth.currentUser?.uid;
  if (uid == null) return Stream.value(const []);
  late StreamController<List<Device>> controller;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? userSub;
  final subscriptions =
      <StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>>[];
  Timer? expiry;
  var generation = 0;
  var closed = false;
  Future<void> select(Map<String, dynamic> user) async {
    final current = ++generation;
    expiry?.cancel();
    for (final subscription in subscriptions.toList()) {
      await subscription.cancel();
    }
    subscriptions.clear();
    if (closed || current != generation) return;
    if (current > 1) controller.add(const []);
    final grants = user['familyAccess'] as Map? ?? const {};
    final linked = normalizeLinkedImeis(
      (user['linkedImeis'] as List? ?? const []).whereType<String>(),
    ).toSet();
    final selected = <(String, String)>[];
    int? nextExpiry;
    final now = DateTime.now().millisecondsSinceEpoch;
    for (final imei in linked.take(30)) {
      final grant = grants[imei] as Map?;
      if (grant != null) {
        final until = grant['untilMs'] as int?;
        if (until != null && until <= now) continue;
        if (until != null && (nextExpiry == null || until < nextExpiry)) {
          nextExpiry = until;
        }
        if (grant['owner'] != true &&
            !(grant['permissions'] as Map? ?? {}).values.contains(true)) {
          continue;
        }
      }
      selected.add((
        imei,
        grant != null && grant['owner'] != true
            ? ((grant['permissions'] as Map?)?['location'] == true
                  ? 'familyDeviceViews'
                  : 'familyDeviceProfiles')
            : 'devices',
      ));
    }
    if (nextExpiry != null) {
      expiry = Timer(
        // Browser timers cannot represent a 30-day delay safely.
        Duration(milliseconds: (nextExpiry - now + 1).clamp(1, 86400000)),
        () => select(user),
      );
    }
    final values = <String, Device>{};
    final ready = <String>{};
    if (selected.isEmpty) controller.add(const []);
    for (final (imei, collection) in selected) {
      final grant = grants[imei] as Map?;
      var planReady = grant == null;
      var accessFailed = false;
      GuardianSubscription? plan;
      DocumentSnapshot<Map<String, dynamic>>? deviceSnapshot;
      void emit() {
        if (closed ||
            accessFailed ||
            current != generation ||
            deviceSnapshot == null ||
            !planReady) {
          return;
        }
        ready.add(imei);
        if (deviceSnapshot!.exists && (plan == null || plan!.serviceActive)) {
          values[imei] = Device.fromDoc(
            deviceSnapshot!,
            sharedSubscription: plan,
            sharedPermissions: grant == null || grant['owner'] == true
                ? null
                : Map<String, bool>.from(grant['permissions'] as Map? ?? {}),
          );
        } else {
          values.remove(imei);
        }
        if (ready.length == selected.length) {
          controller.add(
            selected
                .map((pair) => values[pair.$1])
                .whereType<Device>()
                .toList(),
          );
        }
      }

      void failed(Object error) {
        if (closed || current != generation) return;
        accessFailed = true;
        ready.add(imei);
        values.remove(imei);
        controller.add(values.values.toList());
        controller.addError(error);
      }

      if (grant != null) {
        subscriptions.add(
          db.collection('familyServices').doc(imei).snapshots().listen((
            snapshot,
          ) {
            final circle = snapshot.data();
            plan = GuardianSubscription.fromMap(
              circle?['subscription'] as Map<String, dynamic>?,
              ownerUid: circle?['ownerUid'] as String?,
            );
            planReady = true;
            emit();
          }, onError: failed),
        );
      }
      subscriptions.add(
        db.collection(collection).doc(imei).snapshots().listen((snapshot) {
          deviceSnapshot = snapshot;
          emit();
        }, onError: failed),
      );
    }
  }

  controller = StreamController<List<Device>>(
    onListen: () {
      userSub = db
          .collection('users')
          .doc(uid)
          .snapshots()
          .listen(
            (snapshot) => select(snapshot.data() ?? {}),
            onError: controller.addError,
          );
    },
    onCancel: () async {
      closed = true;
      generation++;
      expiry?.cancel();
      await userSub?.cancel();
      for (final subscription in subscriptions) {
        await subscription.cancel();
      }
    },
  );
  return controller.stream;
}

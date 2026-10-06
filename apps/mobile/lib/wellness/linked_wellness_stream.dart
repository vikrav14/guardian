import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Switch subscriptions immediately on sign-out or unlink, clearing old data.
/// Firestore still enforces linked membership, plan windows and consent.
Stream<List<T>> watchLinkedWellnessData<T>(
  FirebaseFirestore db,
  FirebaseAuth auth,
  String imei,
  Stream<List<T>> Function() query, {
  String permission = 'wellbeing',
}) {
  late StreamController<List<T>> controller;
  StreamSubscription<User?>? authSub;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? userSub;
  StreamSubscription<List<T>>? dataSub;
  List<String>? activeLinkedImeis;
  bool? activeGrant;
  int? activeUntil;
  Timer? expiry;
  var authGeneration = 0;
  var dataGeneration = 0;
  var closed = false;
  controller = StreamController<List<T>>(
    onListen: () {
      authSub = auth.authStateChanges().listen(
        (user) async {
          final generation = ++authGeneration;
          ++dataGeneration;
          activeLinkedImeis = null;
          activeGrant = null;
          expiry?.cancel();
          controller.add(<T>[]);
          await userSub?.cancel();
          await dataSub?.cancel();
          if (closed || generation != authGeneration || user == null) return;
          userSub = db
              .collection('users')
              .doc(user.uid)
              .snapshots()
              .listen(
                (snap) async {
                  final linked =
                      (snap.data()?['linkedImeis'] as List?)
                          ?.whereType<String>()
                          .toList(growable: false) ??
                      const <String>[];
                  final grant =
                      (snap.data()?['familyAccess'] as Map?)?[imei] as Map?;
                  final until = grant?['untilMs'] as int?;
                  final permitted =
                      (until == null ||
                          until > DateTime.now().millisecondsSinceEpoch) &&
                      (grant == null ||
                          grant['owner'] == true ||
                          (grant['permissions'] as Map?)?[permission] == true);
                  // The owner document also contains unrelated fields such as
                  // FCM tokens and profile data. Those updates must not tear
                  // down live Wellness streams or blank the current cards.
                  if (activeLinkedImeis != null &&
                      _sameLinkedImeis(activeLinkedImeis!, linked) &&
                      activeGrant == permitted &&
                      activeUntil == until) {
                    return;
                  }
                  activeLinkedImeis = linked;
                  activeGrant = permitted;
                  activeUntil = until;
                  expiry?.cancel();
                  final dataToken = ++dataGeneration;
                  await dataSub?.cancel();
                  if (closed ||
                      generation != authGeneration ||
                      dataToken != dataGeneration) {
                    return;
                  }
                  controller.add(<T>[]);
                  if (!linked.contains(imei) || !permitted) return;
                  if (until != null) {
                    void expireWhenDue() {
                      final remaining =
                          until - DateTime.now().millisecondsSinceEpoch + 1;
                      if (remaining <= 0) {
                        ++dataGeneration;
                        dataSub?.cancel();
                        if (!closed) controller.add(<T>[]);
                      } else if (!closed && dataToken == dataGeneration) {
                        expiry = Timer(
                          Duration(milliseconds: remaining.clamp(1, 86400000)),
                          expireWhenDue,
                        );
                      }
                    }

                    expireWhenDue();
                  }
                  dataSub = query().listen(
                    (values) {
                      if (!closed && dataToken == dataGeneration) {
                        controller.add(values);
                      }
                    },
                    onError: (Object error, StackTrace stack) {
                      if (!closed && dataToken == dataGeneration) {
                        controller.add(<T>[]);
                        controller.addError(error, stack);
                      }
                    },
                  );
                },
                onError: (Object error, StackTrace stack) {
                  ++dataGeneration;
                  dataSub?.cancel();
                  expiry?.cancel();
                  if (!closed) controller.add(<T>[]);
                  if (!closed) controller.addError(error, stack);
                },
              );
        },
        onError: (Object error, StackTrace stack) {
          ++authGeneration;
          ++dataGeneration;
          activeLinkedImeis = null;
          dataSub?.cancel();
          expiry?.cancel();
          if (!closed) controller.add(<T>[]);
          if (!closed) controller.addError(error, stack);
        },
      );
    },
    onCancel: () async {
      closed = true;
      ++authGeneration;
      ++dataGeneration;
      expiry?.cancel();
      await authSub?.cancel();
      await userSub?.cancel();
      await dataSub?.cancel();
    },
  );
  return controller.stream;
}

bool _sameLinkedImeis(List<String> a, List<String> b) {
  final left = a.toSet();
  final right = b.toSet();
  return left.length == right.length && left.containsAll(right);
}

import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Switch subscriptions immediately on sign-out or unlink, clearing old data.
/// Firestore still enforces linked membership, plan windows and consent.
Stream<List<T>> watchLinkedWellnessData<T>(
  FirebaseFirestore db,
  FirebaseAuth auth,
  String imei,
  Stream<List<T>> Function() query,
) {
  late StreamController<List<T>> controller;
  StreamSubscription<User?>? authSub;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? userSub;
  StreamSubscription<List<T>>? dataSub;
  List<String>? activeLinkedImeis;
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
                  // The owner document also contains unrelated fields such as
                  // FCM tokens and profile data. Those updates must not tear
                  // down live Wellness streams or blank the current cards.
                  if (activeLinkedImeis != null &&
                      _sameLinkedImeis(activeLinkedImeis!, linked)) {
                    return;
                  }
                  activeLinkedImeis = linked;
                  final dataToken = ++dataGeneration;
                  await dataSub?.cancel();
                  if (closed ||
                      generation != authGeneration ||
                      dataToken != dataGeneration) {
                    return;
                  }
                  controller.add(<T>[]);
                  if (!linked.contains(imei)) return;
                  dataSub = query().listen(
                    (values) {
                      if (!closed && dataToken == dataGeneration) {
                        controller.add(values);
                      }
                    },
                    onError: (Object error, StackTrace stack) {
                      if (!closed && dataToken == dataGeneration) {
                        controller.addError(error, stack);
                      }
                    },
                  );
                },
                onError: (Object error, StackTrace stack) {
                  ++dataGeneration;
                  dataSub?.cancel();
                  if (!closed) controller.addError(error, stack);
                },
              );
        },
        onError: (Object error, StackTrace stack) {
          ++authGeneration;
          ++dataGeneration;
          activeLinkedImeis = null;
          dataSub?.cancel();
          if (!closed) controller.addError(error, stack);
        },
      );
    },
    onCancel: () async {
      closed = true;
      ++authGeneration;
      ++dataGeneration;
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

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
  var authGeneration = 0;
  var dataGeneration = 0;
  var closed = false;
  controller = StreamController<List<T>>(
    onListen: () {
      authSub = auth.authStateChanges().listen(
        (user) async {
          final generation = ++authGeneration;
          ++dataGeneration;
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
                  final dataToken = ++dataGeneration;
                  controller.add(<T>[]);
                  await dataSub?.cancel();
                  if (closed ||
                      generation != authGeneration ||
                      dataToken != dataGeneration) {
                    return;
                  }
                  final linked = snap.data()?['linkedImeis'];
                  if (linked is! List || !linked.contains(imei)) return;
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

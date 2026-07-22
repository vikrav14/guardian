import 'package:firebase_storage/firebase_storage.dart';

import 'avatar_upload.dart';

AvatarUploadTransport createAvatarUploadTransport({FirebaseStorage? storage}) =>
    FirebaseAvatarUploadTransport(storage ?? FirebaseStorage.instance);

class FirebaseAvatarUploadTransport implements AvatarUploadTransport {
  FirebaseAvatarUploadTransport(this.storage);

  final FirebaseStorage storage;

  @override
  bool get requiresIdToken => false;

  @override
  Future<String> upload(AvatarUploadRequest request) async {
    final ref = storage.ref(request.objectPath);
    final task = ref.putData(
      request.bytes,
      SettableMetadata(contentType: request.contentType),
    );
    final subscription = task.snapshotEvents.listen((snapshot) {
      final total = snapshot.totalBytes;
      request.onProgress(total == 0 ? null : snapshot.bytesTransferred / total);
    });
    try {
      await task;
    } finally {
      await subscription.cancel();
    }
    return ref.getDownloadURL();
  }
}

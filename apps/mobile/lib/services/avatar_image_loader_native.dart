import 'dart:typed_data';

import 'package:firebase_storage/firebase_storage.dart';

import 'avatar_storage_urls.dart';

Future<Uint8List?> loadAvatarImageBytes(String url) async {
  final location = parseFirebaseStorageMediaUrl(url);
  if (location == null) return null;
  try {
    final data = await FirebaseStorage.instance
        .ref(location.objectPath)
        .getData(5 * 1024 * 1024);
    if (data == null || data.isEmpty) return null;
    return data;
  } catch (_) {
    return null;
  }
}

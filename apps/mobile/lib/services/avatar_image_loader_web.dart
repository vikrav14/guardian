import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';

import 'avatar_image_strategy.dart';
import 'avatar_storage_urls.dart';

/// Loads avatar bytes through the Firebase Storage SDK.
///
/// On web, `Reference.getData()` resolves a download URL and fetches bytes via
/// XHR, so the bucket must have CORS configured — see `firebase/storage.cors.json`.
/// Widget avatars with download tokens use [WebHtmlElementStrategy.prefer]
/// instead because HTML `<img>` tags do not require CORS.
Future<Uint8List?> loadAvatarImageBytes(String url) async {
  if (shouldPreferWebHtmlElementAvatar(url)) {
    if (kDebugMode) {
      debugPrint(
        'Avatar SDK byte load skipped for token URL $url '
        '(use HTML img/canvas instead)',
      );
    }
    return null;
  }

  final location = parseFirebaseStorageMediaUrl(url);
  if (location == null) {
    if (kDebugMode) {
      debugPrint('Avatar auth load skipped: could not parse Storage URL $url');
    }
    return null;
  }
  try {
    if (kDebugMode) {
      debugPrint(
        'Avatar byte load via Storage SDK: ${location.objectPath} '
        '(token=${location.downloadToken != null}, '
        'htmlElement=${shouldPreferWebHtmlElementAvatar(url)})',
      );
    }
    final data = await FirebaseStorage.instance
        .ref(location.objectPath)
        .getData(5 * 1024 * 1024);
    if (data == null || data.isEmpty) {
      if (kDebugMode) {
        debugPrint(
          'Avatar auth load returned empty bytes for ${location.objectPath}',
        );
      }
      return null;
    }
    return data;
  } catch (error, stackTrace) {
    if (kDebugMode) {
      debugPrint(
        'Avatar auth load threw for ${location.objectPath}: $error\n$stackTrace',
      );
    }
    return null;
  }
}

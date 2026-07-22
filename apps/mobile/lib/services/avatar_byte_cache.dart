import 'dart:typed_data';

import 'avatar_storage_urls.dart';

/// In-memory avatar bytes keyed by Firebase Storage object path.
///
/// Populated after upload so map markers can render without a second fetch.
/// Also filled when a web HTML-image load succeeds for map bitmap rendering.
class AvatarByteCache {
  AvatarByteCache._();

  static final Map<String, Uint8List> _byObjectPath = {};

  static Uint8List? get(String url) {
    final path = parseFirebaseStorageMediaUrl(url)?.objectPath;
    if (path == null) return null;
    return _byObjectPath[path];
  }

  static void put(String url, Uint8List bytes) {
    final path = parseFirebaseStorageMediaUrl(url)?.objectPath;
    if (path != null) {
      _byObjectPath[path] = bytes;
    }
  }

  static void putPath(String objectPath, Uint8List bytes) {
    final trimmed = objectPath.trim();
    if (trimmed.isNotEmpty) {
      _byObjectPath[trimmed] = bytes;
    }
  }
}

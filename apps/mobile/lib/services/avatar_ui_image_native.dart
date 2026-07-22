import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'avatar_byte_cache.dart';
import 'avatar_image_loader.dart';
import 'avatar_image_strategy.dart';
import 'avatar_storage_urls.dart';

Future<ui.Image?> loadAvatarUiImage(String url) async {
  final cached = AvatarByteCache.get(url);
  if (cached != null) {
    return _decodeImage(cached);
  }

  if (isFirebaseStorageMediaUrl(url)) {
    final bytes = await loadAvatarImageBytes(url);
    if (bytes != null && bytes.isNotEmpty) {
      AvatarByteCache.put(url, bytes);
      return _decodeImage(bytes);
    }
    if (shouldLoadAvatarBytesViaSdk(url)) {
      return null;
    }
  }

  return null;
}

Future<ui.Image?> _decodeImage(List<int> bytes) async {
  final completer = Completer<ui.Image?>();
  ui.decodeImageFromList(
    bytes is Uint8List ? bytes : Uint8List.fromList(bytes),
    (image) {
      if (!completer.isCompleted) completer.complete(image);
    },
  );
  return completer.future.timeout(
    const Duration(seconds: 4),
    onTimeout: () => null,
  );
}

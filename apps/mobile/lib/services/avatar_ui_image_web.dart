import 'dart:async';
import 'dart:js_interop';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:web/web.dart' as web;

import 'avatar_byte_cache.dart';
import 'avatar_image_loader.dart';
import 'avatar_image_strategy.dart';

/// Loads avatar pixels for map marker bitmaps on web.
///
/// Token URLs use an HTML `<img>` (no XHR) plus canvas export, matching widget
/// avatars. Auth-only Storage URLs still use the Firebase SDK (`getData()`),
/// which requires bucket CORS.
Future<ui.Image?> loadAvatarUiImage(String url) async {
  final cached = AvatarByteCache.get(url);
  if (cached != null) {
    return _decodeImage(cached);
  }

  if (shouldPreferWebHtmlElementAvatar(url)) {
    final image = await _loadViaHtmlImageElement(url);
    if (image != null) return image;
  }

  if (shouldLoadAvatarBytesViaSdk(url)) {
    final bytes = await loadAvatarImageBytes(url);
    if (bytes != null && bytes.isNotEmpty) {
      AvatarByteCache.put(url, bytes);
      return _decodeImage(bytes);
    }
  }

  return null;
}

Future<ui.Image?> _loadViaHtmlImageElement(String url) async {
  final withCors = await _htmlImageToUiImage(url, crossOrigin: true);
  if (withCors != null) return withCors;
  return _htmlImageToUiImage(url, crossOrigin: false);
}

Future<ui.Image?> _htmlImageToUiImage(
  String url, {
  required bool crossOrigin,
}) async {
  final completer = Completer<ui.Image?>();
  final img = web.HTMLImageElement();
  if (crossOrigin) {
    img.crossOrigin = 'anonymous';
  }

  late final JSFunction loadListener;
  late final JSFunction errorListener;

  void cleanup() {
    img.removeEventListener('load', loadListener);
    img.removeEventListener('error', errorListener);
  }

  loadListener = ((web.Event _) {
    unawaited(_finishHtmlImageLoad(
      completer: completer,
      img: img,
      url: url,
      crossOrigin: crossOrigin,
      cleanup: cleanup,
    ));
  }).toJS;

  errorListener = ((web.Event _) {
    if (!completer.isCompleted) completer.complete(null);
    cleanup();
  }).toJS;

  img.addEventListener('load', loadListener);
  img.addEventListener('error', errorListener);
  img.src = url;

  return completer.future.timeout(
    const Duration(seconds: 8),
    onTimeout: () {
      cleanup();
      return null;
    },
  );
}

Future<void> _finishHtmlImageLoad({
  required Completer<ui.Image?> completer,
  required web.HTMLImageElement img,
  required String url,
  required bool crossOrigin,
  required VoidCallback cleanup,
}) async {
  try {
    final width = img.naturalWidth;
    final height = img.naturalHeight;
    if (width <= 0 || height <= 0) {
      if (!completer.isCompleted) completer.complete(null);
      return;
    }

    final canvas = web.HTMLCanvasElement()
      ..width = width
      ..height = height;
    canvas.context2D.drawImage(img, 0, 0);
    final bytes = await _readCanvasPngBytes(canvas);
    if (bytes == null || bytes.isEmpty) {
      if (!completer.isCompleted) completer.complete(null);
      return;
    }

    AvatarByteCache.put(url, bytes);
    final decoded = await _decodeImage(bytes);
    if (!completer.isCompleted) completer.complete(decoded);
  } catch (error, stackTrace) {
    if (kDebugMode) {
      debugPrint(
        'Avatar HTML canvas load failed for $url '
        '(crossOrigin=$crossOrigin): $error\n$stackTrace',
      );
    }
    if (!completer.isCompleted) completer.complete(null);
  } finally {
    cleanup();
  }
}

Future<Uint8List?> _readCanvasPngBytes(web.HTMLCanvasElement canvas) {
  final result = Completer<Uint8List?>();
  canvas.toBlob(
    ((web.Blob? blob) {
      if (blob == null) {
        result.complete(null);
        return;
      }
      unawaited(_readBlob(blob).then(result.complete));
    }).toJS,
    'image/png',
  );
  return result.future.timeout(
    const Duration(seconds: 4),
    onTimeout: () => null,
  );
}

Future<Uint8List?> _readBlob(web.Blob blob) {
  final reader = web.FileReader();
  final result = Completer<Uint8List?>();
  late final JSFunction loadListener;
  late final JSFunction errorListener;

  void cleanup() {
    reader.removeEventListener('load', loadListener);
    reader.removeEventListener('error', errorListener);
  }

  loadListener = ((web.Event _) {
    final value = reader.result;
    if (value == null || !value.isA<JSArrayBuffer>()) {
      if (!result.isCompleted) result.complete(null);
      cleanup();
      return;
    }
    if (!result.isCompleted) {
      result.complete(Uint8List.view((value as JSArrayBuffer).toDart));
    }
    cleanup();
  }).toJS;

  errorListener = ((web.Event _) {
    if (!result.isCompleted) result.complete(null);
    cleanup();
  }).toJS;

  reader.addEventListener('load', loadListener);
  reader.addEventListener('error', errorListener);
  reader.readAsArrayBuffer(blob);
  return result.future;
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

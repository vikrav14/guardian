import 'dart:ui' as ui;

import 'avatar_ui_image_native.dart'
    if (dart.library.js_interop) 'avatar_ui_image_web.dart'
    as platform;

/// Loads a decoded avatar image for canvas rendering (map marker bitmaps).
Future<ui.Image?> loadAvatarUiImage(String url) =>
    platform.loadAvatarUiImage(url);

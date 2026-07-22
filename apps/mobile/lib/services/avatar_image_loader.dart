import 'dart:typed_data';

import 'avatar_image_loader_native.dart'
    if (dart.library.js_interop) 'avatar_image_loader_web.dart'
    as platform;

Future<Uint8List?> loadAvatarImageBytes(String url) =>
    platform.loadAvatarImageBytes(url);

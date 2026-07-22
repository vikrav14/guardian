import 'dart:async';
import 'dart:typed_data';

import 'avatar_image_picker_native.dart'
    if (dart.library.js_interop) 'avatar_image_picker_web.dart'
    as platform;

class AvatarImage {
  const AvatarImage({
    required this.bytes,
    required this.mimeType,
    required this.filename,
  });

  final Uint8List bytes;
  final String mimeType;
  final String filename;
}

class AvatarImagePickerException implements Exception {
  const AvatarImagePickerException(this.message);

  final String message;

  @override
  String toString() => message;
}

abstract interface class AvatarImagePicker {
  Future<AvatarImage?> pick();
}

class AvatarImageSelection {
  AvatarImageSelection({
    AvatarImagePicker? picker,
    this.pickerTimeout = const Duration(minutes: 2),
  }) : _picker = picker ?? platform.createAvatarImagePicker();

  static const maxBytes = 5 * 1024 * 1024;

  final AvatarImagePicker _picker;
  final Duration pickerTimeout;

  Future<AvatarImage?> pick() async {
    final AvatarImage? image;
    try {
      image = await _picker.pick().timeout(pickerTimeout);
    } on TimeoutException {
      throw AvatarImagePickerException(
        '[selection] The photo picker did not finish after '
        '${pickerTimeout.inSeconds} seconds. Close it and try again.',
      );
    } on AvatarImagePickerException {
      rethrow;
    } catch (_) {
      throw const AvatarImagePickerException(
        '[read] The selected photo could not be read. Try a different image.',
      );
    }
    if (image != null && image.bytes.length > maxBytes) {
      throw const AvatarImagePickerException(
        '[read] Please choose an image smaller than 5 MB.',
      );
    }
    return image;
  }
}

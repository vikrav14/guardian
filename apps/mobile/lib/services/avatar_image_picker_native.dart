import 'package:image_picker/image_picker.dart';

import 'avatar_image_picker.dart';

AvatarImagePicker createAvatarImagePicker() => NativeAvatarImagePicker();

class NativeAvatarImagePicker implements AvatarImagePicker {
  NativeAvatarImagePicker({ImagePicker? picker})
    : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<AvatarImage?> pick() async {
    final image = await _picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 88,
    );
    if (image == null) return null;

    return AvatarImage(
      bytes: await image.readAsBytes(),
      mimeType: image.mimeType ?? _mimeTypeForName(image.name),
      filename: image.name,
    );
  }
}

String _mimeTypeForName(String name) {
  final extension = name.toLowerCase().split('.').last;
  return switch (extension) {
    'png' => 'image/png',
    'webp' => 'image/webp',
    _ => 'image/jpeg',
  };
}

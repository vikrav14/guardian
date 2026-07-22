import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';

import 'avatar_byte_cache.dart';
import 'avatar_image_picker.dart';
import 'avatar_upload.dart';
import 'guardian_avatar_service.dart' show AvatarUpdateException;
import 'guardian_services.dart';

class DeviceAvatarService {
  DeviceAvatarService({
    FirebaseAuth? auth,
    FirebaseStorage? storage,
    AvatarImageSelection? imageSelection,
    DeviceService? devices,
    this.uploadTransport,
    this.uploadTimeout = const Duration(seconds: 30),
    this.saveTimeout = const Duration(seconds: 15),
  }) : _auth = auth ?? FirebaseAuth.instance,
       _storage = storage ?? FirebaseStorage.instance,
       _imageSelection = imageSelection ?? AvatarImageSelection(),
       _devices = devices ?? DeviceService();

  static const maxBytes = AvatarImageSelection.maxBytes;

  final FirebaseAuth _auth;
  final FirebaseStorage _storage;
  final AvatarImageSelection _imageSelection;
  final DeviceService _devices;
  final AvatarUploadTransport? uploadTransport;
  final Duration uploadTimeout;
  final Duration saveTimeout;

  Future<bool> chooseAndUpload(String imei) async {
    final image = await _imageSelection.pick();
    if (image == null) return false;

    final String downloadUrl;
    try {
      downloadUrl = await _uploadAvatarBytes(imei, image).timeout(uploadTimeout);
    } on TimeoutException {
      throw const AvatarUpdateException(
        'Photo upload timed out. Check your connection and Firebase Storage '
        'bucket, then try again.',
      );
    } on FirebaseException catch (error) {
      throw AvatarUpdateException(
        'Photo upload failed in Firebase Storage (${error.code}). '
        'Verify Storage rules and try again.',
      );
    } on AvatarUploadTransportException catch (error) {
      throw AvatarUpdateException(
        'Photo upload failed (${error.message}). Verify Storage rules and try again.',
      );
    }
    final uri = Uri.parse(downloadUrl);
    final avatarUrl = uri
        .replace(
          queryParameters: {
            ...uri.queryParameters,
            'v': DateTime.now().millisecondsSinceEpoch.toString(),
          },
        )
        .toString();
    AvatarByteCache.putPath('deviceAvatars/$imei/avatar', image.bytes);
    AvatarByteCache.put(avatarUrl, image.bytes);
    try {
      await _devices.updateAvatarUrl(imei, avatarUrl).timeout(saveTimeout);
    } on TimeoutException {
      throw const AvatarUpdateException(
        'The photo uploaded, but saving it to the device timed out. '
        'Check Firestore access and try again.',
      );
    }
    return true;
  }

  Future<void> remove(String imei) async {
    try {
      await _storage
          .ref('deviceAvatars/$imei/avatar')
          .delete()
          .timeout(uploadTimeout);
    } on TimeoutException {
      throw const AvatarUpdateException(
        'Removing the photo timed out. Check your connection and try again.',
      );
    } on FirebaseException catch (error) {
      if (error.code != 'object-not-found') rethrow;
    }
    await _devices.updateAvatarUrl(imei, null).timeout(
      saveTimeout,
      onTimeout: () => throw const AvatarUpdateException(
        'The photo was removed from Storage, but the Firestore update timed out.',
      ),
    );
  }

  Future<String> _uploadAvatarBytes(String imei, AvatarImage image) async {
    final transport =
        uploadTransport ?? createAvatarUploadTransport(storage: _storage);
    if (transport.requiresIdToken) {
      final idToken = await _auth.currentUser?.getIdToken();
      if (idToken == null || idToken.isEmpty) {
        throw const AvatarUploadTransportException(
          AvatarUploadFailureKind.invalidResponse,
          'Firebase Auth did not provide an ID token. Sign in again and retry.',
        );
      }
      final bucket = Firebase.app().options.storageBucket;
      if (bucket == null || bucket.isEmpty) {
        throw const AvatarUploadTransportException(
          AvatarUploadFailureKind.invalidResponse,
          'Firebase Storage bucket is missing from firebase_options.dart.',
        );
      }
      return transport.upload(
        AvatarUploadRequest(
          bucket: bucket,
          objectPath: 'deviceAvatars/$imei/avatar',
          bytes: image.bytes,
          contentType: image.mimeType,
          idToken: idToken,
          timeout: uploadTimeout,
          onProgress: (_) {},
        ),
      );
    }

    final ref = _storage.ref('deviceAvatars/$imei/avatar');
    await ref.putData(
      image.bytes,
      SettableMetadata(contentType: image.mimeType),
    );
    return ref.getDownloadURL();
  }
}

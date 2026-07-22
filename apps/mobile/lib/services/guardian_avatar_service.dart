import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';

import 'avatar_byte_cache.dart';
import 'avatar_image_picker.dart';
import 'avatar_upload.dart';
import 'guardian_services.dart';

typedef GuardianAvatarUpload =
    Future<String> Function(String uid, AvatarImage image);
typedef GuardianAvatarSave = Future<void> Function(String? avatarUrl);
typedef GuardianAvatarIdToken = Future<String?> Function();
typedef AvatarUpdateProgressCallback =
    void Function(AvatarUpdateProgress progress);

enum AvatarUpdateStage { selection, upload, profileSave }

class AvatarUpdateProgress {
  const AvatarUpdateProgress(this.stage, {this.fraction});

  final AvatarUpdateStage stage;
  final double? fraction;
}

class AvatarUpdateException implements Exception {
  const AvatarUpdateException(this.message);

  final String message;

  @override
  String toString() => message;
}

class GuardianAvatarService {
  GuardianAvatarService({
    this.auth,
    this.storage,
    AvatarImageSelection? imageSelection,
    this.profiles,
    this.currentUserId,
    this.upload,
    this.saveAvatarUrl,
    this.uploadTransport,
    this.idTokenProvider,
    this.storageBucket,
    this.uploadTimeout = const Duration(seconds: 30),
    this.saveTimeout = const Duration(seconds: 15),
  }) : _imageSelection = imageSelection ?? AvatarImageSelection();

  final FirebaseAuth? auth;
  final FirebaseStorage? storage;
  final AvatarImageSelection _imageSelection;
  final UserProfileService? profiles;
  final String? Function()? currentUserId;
  final GuardianAvatarUpload? upload;
  final GuardianAvatarSave? saveAvatarUrl;
  final AvatarUploadTransport? uploadTransport;
  final GuardianAvatarIdToken? idTokenProvider;
  final String? storageBucket;
  final Duration uploadTimeout;
  final Duration saveTimeout;

  Future<bool> chooseAndUpload({
    AvatarUpdateProgressCallback? onProgress,
  }) async {
    final uid =
        currentUserId?.call() ??
        (auth ?? FirebaseAuth.instance).currentUser?.uid;
    if (uid == null) {
      throw const AvatarUpdateException(
        '[selection] You are no longer signed in. Sign in and try again.',
      );
    }

    onProgress?.call(const AvatarUpdateProgress(AvatarUpdateStage.selection));
    final AvatarImage? image;
    try {
      image = await _imageSelection.pick();
    } on AvatarImagePickerException catch (error) {
      throw AvatarUpdateException(error.message);
    } catch (error) {
      throw AvatarUpdateException(
        '[selection] The photo chooser failed ($error). Try again.',
      );
    }
    if (image == null) return false;

    onProgress?.call(
      const AvatarUpdateProgress(AvatarUpdateStage.upload, fraction: 0),
    );
    final String downloadUrl;
    try {
      downloadUrl =
          await (upload != null
                  ? upload!(uid, image)
                  : _uploadWithTransport(uid, image, onProgress))
              .timeout(uploadTimeout);
    } on TimeoutException {
      throw AvatarUpdateException(
        '[upload] Photo upload timed out after ${uploadTimeout.inSeconds} '
        'seconds. Check your connection and Firebase Storage bucket, then try again.',
      );
    } on FirebaseException catch (error) {
      throw AvatarUpdateException(_storageErrorMessage(error));
    } on AvatarUploadTransportException catch (error) {
      throw AvatarUpdateException(_transportErrorMessage(error));
    } on AvatarUpdateException {
      rethrow;
    } catch (error) {
      throw AvatarUpdateException(
        '[upload] Photo upload failed ($error). Check your connection and try again.',
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
    AvatarByteCache.putPath('guardianAvatars/$uid/avatar', image.bytes);
    AvatarByteCache.put(avatarUrl, image.bytes);
    onProgress?.call(const AvatarUpdateProgress(AvatarUpdateStage.profileSave));
    try {
      await (saveAvatarUrl ?? _saveToFirestore)(avatarUrl).timeout(saveTimeout);
    } on TimeoutException {
      throw AvatarUpdateException(
        '[profile save] The photo uploaded, but saving it to your profile '
        'timed out after ${saveTimeout.inSeconds} seconds. '
        'Check Firestore access and try again.',
      );
    } on FirebaseException catch (error) {
      throw AvatarUpdateException(
        '[profile save] The photo uploaded, but Firestore could not save your profile '
        '(${error.code}). Verify Firestore rules and try again.',
      );
    } catch (error) {
      throw AvatarUpdateException(
        '[profile save] The photo uploaded, but the profile save failed '
        '($error). Check Firestore access and try again.',
      );
    }
    return true;
  }

  Future<void> remove() async {
    final uid =
        currentUserId?.call() ??
        (auth ?? FirebaseAuth.instance).currentUser?.uid;
    if (uid == null) throw StateError('Not signed in');
    try {
      await (storage ?? FirebaseStorage.instance)
          .ref('guardianAvatars/$uid/avatar')
          .delete()
          .timeout(uploadTimeout);
    } on TimeoutException {
      throw const AvatarUpdateException(
        'Removing the photo timed out. Check your connection and try again.',
      );
    } on FirebaseException catch (error) {
      if (error.code != 'object-not-found') rethrow;
    }
    try {
      await (saveAvatarUrl ?? _saveToFirestore)(null).timeout(saveTimeout);
    } on TimeoutException {
      throw const AvatarUpdateException(
        'The photo was removed from Storage, but the profile update timed out.',
      );
    }
  }

  Future<String> _uploadWithTransport(
    String uid,
    AvatarImage image,
    AvatarUpdateProgressCallback? onProgress,
  ) async {
    final transport =
        uploadTransport ?? createAvatarUploadTransport(storage: storage);
    final String? idToken;
    if (transport.requiresIdToken) {
      idToken =
          await (idTokenProvider?.call() ??
              (auth ?? FirebaseAuth.instance).currentUser?.getIdToken());
      if (idToken == null || idToken.isEmpty) {
        throw const AvatarUploadTransportException(
          AvatarUploadFailureKind.invalidResponse,
          'Firebase Auth did not provide an ID token. Sign in again and retry.',
        );
      }
    } else {
      idToken = null;
    }
    final bucket =
        storageBucket ??
        Firebase.app().options.storageBucket ??
        (throw const AvatarUploadTransportException(
          AvatarUploadFailureKind.invalidResponse,
          'Firebase Storage bucket is missing from firebase_options.dart.',
        ));
    return transport.upload(
      AvatarUploadRequest(
        bucket: bucket,
        objectPath: 'guardianAvatars/$uid/avatar',
        bytes: image.bytes,
        contentType: image.mimeType,
        idToken: idToken,
        timeout: uploadTimeout,
        onProgress: (fraction) {
          onProgress?.call(
            AvatarUpdateProgress(AvatarUpdateStage.upload, fraction: fraction),
          );
        },
      ),
    );
  }

  Future<void> _saveToFirestore(String? avatarUrl) {
    return (profiles ?? UserProfileService()).updateAvatarUrl(avatarUrl);
  }

  String _storageErrorMessage(FirebaseException error) {
    if (error.code == 'unauthorized') {
      return '[upload] Firebase Storage rejected the photo. Deploy storage.rules and '
          'confirm you are signed in, then try again.';
    }
    if (error.code == 'bucket-not-found' || error.code == 'unknown') {
      return '[upload] Firebase Storage is unavailable (${error.code}). Confirm the '
          'guardian-fbadd.firebasestorage.app bucket exists and is configured.';
    }
    return '[upload] Photo upload failed in Firebase Storage (${error.code}). '
        'Check your connection and try again.';
  }

  String _transportErrorMessage(AvatarUploadTransportException error) {
    if (error.statusCode == 401 || error.statusCode == 403) {
      return '[upload] ${error.message}. Sign in again and verify the deployed '
          'guardianAvatars rule for this account.';
    }
    return '[upload] ${error.message}';
  }
}

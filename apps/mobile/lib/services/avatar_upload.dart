import 'dart:typed_data';

import 'package:firebase_storage/firebase_storage.dart';

import 'avatar_upload_native.dart'
    if (dart.library.js_interop) 'avatar_upload_web.dart'
    as platform;

typedef AvatarUploadProgress = void Function(double? fraction);

class AvatarUploadRequest {
  const AvatarUploadRequest({
    required this.bucket,
    required this.objectPath,
    required this.bytes,
    required this.contentType,
    required this.timeout,
    required this.onProgress,
    this.idToken,
  });

  final String bucket;
  final String objectPath;
  final Uint8List bytes;
  final String contentType;
  final String? idToken;
  final Duration timeout;
  final AvatarUploadProgress onProgress;
}

enum AvatarUploadFailureKind { http, network, timeout, invalidResponse }

class AvatarUploadTransportException implements Exception {
  const AvatarUploadTransportException(
    this.kind,
    this.message, {
    this.statusCode,
  });

  final AvatarUploadFailureKind kind;
  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

abstract interface class AvatarUploadTransport {
  bool get requiresIdToken;

  Future<String> upload(AvatarUploadRequest request);
}

AvatarUploadTransport createAvatarUploadTransport({FirebaseStorage? storage}) =>
    platform.createAvatarUploadTransport(storage: storage);

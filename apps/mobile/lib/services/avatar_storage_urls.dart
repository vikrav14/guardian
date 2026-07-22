import 'dart:convert';
import 'dart:math';

class FirebaseStorageMediaLocation {
  const FirebaseStorageMediaLocation({
    required this.bucket,
    required this.objectPath,
    this.downloadToken,
  });

  final String bucket;
  final String objectPath;
  final String? downloadToken;
}

String generateFirebaseDownloadToken() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

Map<String, dynamic> buildFirebaseUploadMetadata({
  required String objectPath,
  required String contentType,
  required String downloadToken,
}) {
  return {
    'name': objectPath,
    'contentType': contentType,
    'metadata': {'firebaseStorageDownloadTokens': downloadToken},
  };
}

String buildFirebaseMediaUploadUrl({
  required String bucket,
  required String objectPath,
}) {
  final encodedBucket = Uri.encodeComponent(bucket);
  final encodedObject = Uri.encodeComponent(objectPath);
  return 'https://firebasestorage.googleapis.com/v0/b/$encodedBucket/o'
      '?uploadType=media&name=$encodedObject';
}

String buildFirebaseMetadataPatchUrl({
  required String bucket,
  required String objectPath,
}) {
  final encodedBucket = Uri.encodeComponent(bucket);
  final encodedObject = Uri.encodeComponent(objectPath);
  return 'https://firebasestorage.googleapis.com/v0/b/$encodedBucket/o/'
      '$encodedObject?updateMask=metadata';
}

Map<String, dynamic> buildFirebaseDownloadTokenMetadata(String downloadToken) {
  return {
    'metadata': {'firebaseStorageDownloadTokens': downloadToken},
  };
}

String buildFirebaseTokenizedDownloadUrl({
  required String bucket,
  required String objectPath,
  required String downloadToken,
}) {
  final encodedBucket = Uri.encodeComponent(bucket);
  final encodedObject = Uri.encodeComponent(objectPath);
  return 'https://firebasestorage.googleapis.com/v0/b/$encodedBucket/o/'
      '$encodedObject?alt=media&token=$downloadToken';
}

String buildFirebaseAuthenticatedMediaUrl({
  required String bucket,
  required String objectPath,
}) {
  final encodedBucket = Uri.encodeComponent(bucket);
  final encodedObject = Uri.encodeComponent(objectPath);
  return 'https://firebasestorage.googleapis.com/v0/b/$encodedBucket/o/'
      '$encodedObject?alt=media';
}

bool isFirebaseStorageMediaUrl(String url) =>
    parseFirebaseStorageMediaUrl(url) != null;

FirebaseStorageMediaLocation? parseFirebaseStorageMediaUrl(String rawUrl) {
  final uri = Uri.tryParse(rawUrl.trim());
  if (uri == null || uri.host != 'firebasestorage.googleapis.com') {
    return null;
  }
  final segments = uri.pathSegments;
  if (segments.length < 5 ||
      segments[0] != 'v0' ||
      segments[1] != 'b' ||
      segments[3] != 'o') {
    return null;
  }
  final bucket = Uri.decodeComponent(segments[2]);
  final objectPath = Uri.decodeComponent(segments.sublist(4).join('/'));
  if (bucket.isEmpty || objectPath.isEmpty) return null;
  final token = uri.queryParameters['token']?.trim();
  return FirebaseStorageMediaLocation(
    bucket: bucket,
    objectPath: objectPath,
    downloadToken: token == null || token.isEmpty ? null : token,
  );
}

String? extractDownloadTokenFromMetadataJson(String jsonBody) {
  try {
    final metadata = jsonDecode(jsonBody) as Map<String, dynamic>;
    final topLevel = metadata['downloadTokens'] as String?;
    final nested = metadata['metadata'];
    final nestedToken = nested is Map<String, dynamic>
        ? nested['firebaseStorageDownloadTokens'] as String?
        : null;
    return _firstDownloadToken(topLevel) ?? _firstDownloadToken(nestedToken);
  } catch (_) {
    return null;
  }
}

String? _firstDownloadToken(String? raw) {
  if (raw == null || raw.trim().isEmpty) return null;
  return raw
      .split(',')
      .map((value) => value.trim())
      .where((value) => value.isNotEmpty)
      .firstOrNull;
}

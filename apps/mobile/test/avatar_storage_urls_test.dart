import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/avatar_storage_urls.dart';

void main() {
  test('buildFirebaseUploadMetadata includes firebaseStorageDownloadTokens', () {
    const token = '11111111-2222-3333-4444-555555555555';
    final metadata = buildFirebaseUploadMetadata(
      objectPath: 'guardianAvatars/user-1/avatar',
      contentType: 'image/jpeg',
      downloadToken: token,
    );

    expect(metadata['name'], 'guardianAvatars/user-1/avatar');
    expect(metadata['contentType'], 'image/jpeg');
    expect(
      (metadata['metadata'] as Map<String, dynamic>)['firebaseStorageDownloadTokens'],
      token,
    );
  });

  test('buildFirebaseMediaUploadUrl includes uploadType and name', () {
    final url = buildFirebaseMediaUploadUrl(
      bucket: 'guardian-fbadd.firebasestorage.app',
      objectPath: 'guardianAvatars/user-1/avatar',
    );

    expect(
      url,
      'https://firebasestorage.googleapis.com/v0/b/'
      'guardian-fbadd.firebasestorage.app/o'
      '?uploadType=media&name=guardianAvatars%2Fuser-1%2Favatar',
    );
  });

  test('buildFirebaseMetadataPatchUrl targets metadata updateMask', () {
    final url = buildFirebaseMetadataPatchUrl(
      bucket: 'guardian-fbadd.firebasestorage.app',
      objectPath: 'guardianAvatars/user-1/avatar',
    );

    expect(
      url,
      'https://firebasestorage.googleapis.com/v0/b/'
      'guardian-fbadd.firebasestorage.app/o/'
      'guardianAvatars%2Fuser-1%2Favatar?updateMask=metadata',
    );
  });

  test('buildFirebaseDownloadTokenMetadata stores firebaseStorageDownloadTokens', () {
    const token = '11111111-2222-3333-4444-555555555555';
    final metadata = buildFirebaseDownloadTokenMetadata(token);

    expect(
      (metadata['metadata'] as Map<String, dynamic>)['firebaseStorageDownloadTokens'],
      token,
    );
  });

  test('buildFirebaseTokenizedDownloadUrl encodes object path and token', () {
    final url = buildFirebaseTokenizedDownloadUrl(
      bucket: 'guardian-fbadd.firebasestorage.app',
      objectPath: 'guardianAvatars/user-1/avatar',
      downloadToken: 'abc-123',
    );

    expect(
      url,
      'https://firebasestorage.googleapis.com/v0/b/'
      'guardian-fbadd.firebasestorage.app/o/'
      'guardianAvatars%2Fuser-1%2Favatar?alt=media&token=abc-123',
    );
  });

  test('isFirebaseStorageMediaUrl detects Firebase Storage media links', () {
    expect(
      isFirebaseStorageMediaUrl(
        'https://firebasestorage.googleapis.com/v0/b/guardian-fbadd.firebasestorage.app/o/'
        'guardianAvatars%2Fuser-1%2Favatar?alt=media&token=abc-123',
      ),
      isTrue,
    );
    expect(isFirebaseStorageMediaUrl('https://example.com/a.jpg'), isFalse);
  });

  test('parseFirebaseStorageMediaUrl reads bucket path and token', () {
    final location = parseFirebaseStorageMediaUrl(
      'https://firebasestorage.googleapis.com/v0/b/guardian-fbadd.firebasestorage.app/o/'
      'guardianAvatars%2Fuser-1%2Favatar?alt=media&token=abc-123&v=42',
    );

    expect(location?.bucket, 'guardian-fbadd.firebasestorage.app');
    expect(location?.objectPath, 'guardianAvatars/user-1/avatar');
    expect(location?.downloadToken, 'abc-123');
  });

  test('extractDownloadTokenFromMetadataJson reads nested metadata token', () {
    const body =
        '{"name":"guardianAvatars/user-1/avatar","metadata":{"firebaseStorageDownloadTokens":"token-a,token-b"}}';

    expect(extractDownloadTokenFromMetadataJson(body), 'token-a');
  });

  test('extractDownloadTokenFromMetadataJson reads top-level downloadTokens', () {
    const body = '{"downloadTokens":"token-a,token-b"}';

    expect(extractDownloadTokenFromMetadataJson(body), 'token-a');
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/avatar_image_strategy.dart';
import 'package:guardian/services/avatar_storage_urls.dart';

void main() {
  const tokenUrl =
      'https://firebasestorage.googleapis.com/v0/b/guardian-fbadd.firebasestorage.app/o/'
      'guardianAvatars%2Fuser-1%2Favatar?alt=media&token=abc-123&v=42';
  const authUrl =
      'https://firebasestorage.googleapis.com/v0/b/guardian-fbadd.firebasestorage.app/o/'
      'guardianAvatars%2Fuser-1%2Favatar?alt=media';

  test('parseFirebaseStorageMediaUrl keeps token with cache-buster param', () {
    final location = parseFirebaseStorageMediaUrl(tokenUrl);
    expect(location?.downloadToken, 'abc-123');
    expect(location?.objectPath, 'guardianAvatars/user-1/avatar');
  });

  test('shouldLoadAvatarBytesViaSdk is false for tokenized Storage URLs', () {
    expect(shouldLoadAvatarBytesViaSdk(tokenUrl), isFalse);
    expect(shouldLoadAvatarBytesViaSdk(authUrl), isTrue);
    expect(shouldLoadAvatarBytesViaSdk('https://example.com/a.jpg'), isFalse);
  });
}

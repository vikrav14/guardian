import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/avatar_byte_cache.dart';

void main() {
  test('AvatarByteCache stores bytes by Storage object path', () {
    const url =
        'https://firebasestorage.googleapis.com/v0/b/guardian-fbadd.firebasestorage.app/o/'
        'deviceAvatars%2Fimei-1%2Favatar?alt=media&token=abc-123&v=42';
    const urlWithNewVersion =
        'https://firebasestorage.googleapis.com/v0/b/guardian-fbadd.firebasestorage.app/o/'
        'deviceAvatars%2Fimei-1%2Favatar?alt=media&token=abc-123&v=99';
    final bytes = Uint8List.fromList([1, 2, 3]);

    AvatarByteCache.putPath('deviceAvatars/imei-1/avatar', bytes);

    expect(AvatarByteCache.get(url), bytes);
    expect(AvatarByteCache.get(urlWithNewVersion), bytes);
    expect(AvatarByteCache.get('https://example.com/a.jpg'), isNull);
  });
}

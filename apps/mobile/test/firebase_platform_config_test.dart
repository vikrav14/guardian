import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/firebase_options.dart';

void main() {
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  test('Android cannot silently reuse the Web Firebase application ID', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    final options = DefaultFirebaseOptions.currentPlatform;
    expect(options.appId, isNot(contains(':web:')));
    expect(
      DefaultFirebaseOptions.isConfigured,
      options.apiKey.isNotEmpty &&
          options.appId.startsWith('1:813482800288:android:'),
    );
  });

  test('existing desktop Web Firebase configuration stays configured', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    expect(DefaultFirebaseOptions.currentPlatform.appId, contains(':web:'));
    expect(DefaultFirebaseOptions.isConfigured, isTrue);
  });
}

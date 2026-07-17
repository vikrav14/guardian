// Firebase options for Guardian (project: guardian-fbadd).
// Web app config from Firebase Console → Project settings → Your apps.

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.windows:
        return web;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not configured for this platform yet.',
        );
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyCTfWyOO0OwIQKjm7nqs0czTz37lDlUT2A',
    appId: '1:813482800288:web:cc6d6dd3d1ec6d6cc205c5',
    messagingSenderId: '813482800288',
    projectId: 'guardian-fbadd',
    authDomain: 'guardian-fbadd.firebaseapp.com',
    storageBucket: 'guardian-fbadd.firebasestorage.app',
    measurementId: 'G-3K8CKY564B',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyCTfWyOO0OwIQKjm7nqs0czTz37lDlUT2A',
    appId: '1:813482800288:web:cc6d6dd3d1ec6d6cc205c5',
    messagingSenderId: '813482800288',
    projectId: 'guardian-fbadd',
    storageBucket: 'guardian-fbadd.firebasestorage.app',
  );

  static bool get isConfigured =>
      !web.apiKey.startsWith('REPLACE_') && !web.appId.startsWith('REPLACE_');
}

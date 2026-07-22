/* global firebase */

// Firebase Messaging looks for this file at the web root. Keep the public web
// configuration in sync with lib/firebase_options.dart.
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCTfWyOO0OwIQKjm7nqs0czTz37lDlUT2A',
  appId: '1:813482800288:web:cc6d6dd3d1ec6d6cc205c5',
  messagingSenderId: '813482800288',
  projectId: 'guardian-fbadd',
  authDomain: 'guardian-fbadd.firebaseapp.com',
  storageBucket: 'guardian-fbadd.firebasestorage.app',
});

firebase.messaging();

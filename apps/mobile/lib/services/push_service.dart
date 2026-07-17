import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../firebase_options.dart';

const _androidChannel = AndroidNotificationChannel(
  'guardian_alerts',
  'Guardian alerts',
  description: 'SOS, fall, geofence, and battery alerts for linked pendants',
  importance: Importance.high,
);

final _localNotifications = FlutterLocalNotificationsPlugin();

/// Runs in a separate isolate when a push arrives while the app is
/// backgrounded/terminated. Android/iOS already render the `notification`
/// payload from the system tray in that state; this is only a required
/// registration point, kept minimal on purpose.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (DefaultFirebaseOptions.isConfigured && Firebase.apps.isEmpty) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  }
}

class PushService {
  PushService({FirebaseFirestore? db}) : _db = db ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  static Future<void> initLocalNotifications() async {
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings();
    await _localNotifications.initialize(
      settings: const InitializationSettings(android: androidInit, iOS: iosInit),
    );
    if (!kIsWeb && Platform.isAndroid) {
      await _localNotifications
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_androidChannel);
    }
  }

  /// Shows a heads-up notification for pushes that arrive while the app is
  /// in the foreground (the OS does not surface these on its own).
  static void listenForegroundMessages() {
    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification == null) return;
      _localNotifications.show(
        id: notification.hashCode,
        title: notification.title,
        body: notification.body,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            _androidChannel.id,
            _androidChannel.name,
            channelDescription: _androidChannel.description,
            importance: Importance.high,
            priority: Priority.high,
          ),
          iOS: const DarwinNotificationDetails(),
        ),
      );
    });
  }

  /// Requests notification permission and stores this device's FCM token on
  /// the signed-in user's profile so the gateway can push alerts to it.
  Future<void> registerForUser(String uid) async {
    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied) return;

    final token = await messaging.getToken();
    if (token != null) {
      await _saveToken(uid, token);
    }
    messaging.onTokenRefresh.listen((refreshed) => _saveToken(uid, refreshed));
  }

  Future<void> _saveToken(String uid, String token) {
    return _db.collection('users').doc(uid).set({
      'fcmTokens': FieldValue.arrayUnion([token]),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  /// Removes this device's token so it stops receiving pushes after sign-out.
  Future<void> unregisterForUser(String uid) async {
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null) return;
    await _db.collection('users').doc(uid).set({
      'fcmTokens': FieldValue.arrayRemove([token]),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }
}

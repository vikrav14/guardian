import 'dart:io';
import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../firebase_options.dart';
import 'voice_notification.dart';

const _messageChannel = AndroidNotificationChannel(
  'guardian_messages',
  'Voice messages',
  description: 'New voice messages from your linked watch',
  importance: Importance.high,
);

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
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }
}

class PushService {
  PushService({FirebaseFirestore? db}) : _db = db ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;
  static bool _listening = false;
  static StreamSubscription<String>? _tokenRefresh;
  static String? _registeredUid;

  static void _openVoice(Map<String, dynamic> data) {
    final target = VoiceNotificationTarget.fromData(data);
    if (target != null) VoiceNotifications.opened.value = target;
  }

  static void _openPayload(String? payload) {
    if (payload == null) return;
    try {
      _openVoice(jsonDecode(payload) as Map<String, dynamic>);
    } catch (_) {
      /* Invalid notification metadata. */
    }
  }

  static Future<void> initLocalNotifications() async {
    if (kIsWeb) return;
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings();
    await _localNotifications.initialize(
      settings: const InitializationSettings(
        android: androidInit,
        iOS: iosInit,
      ),
      onDidReceiveNotificationResponse: (response) =>
          _openPayload(response.payload),
    );
    if (!kIsWeb && Platform.isAndroid) {
      await _localNotifications
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.createNotificationChannel(_androidChannel);
      await _localNotifications
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.createNotificationChannel(_messageChannel);
    }
    final launch = await _localNotifications.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp == true) {
      _openPayload(launch?.notificationResponse?.payload);
    }
  }

  /// Shows a heads-up notification for pushes that arrive while the app is
  /// in the foreground (the OS does not surface these on its own).
  static void listenForegroundMessages() {
    if (_listening) return;
    _listening = true;
    FirebaseMessaging.onMessageOpenedApp.listen(
      (message) => _openVoice(message.data),
    );
    unawaited(
      FirebaseMessaging.instance
          .getInitialMessage()
          .then((message) {
            if (message != null) _openVoice(message.data);
          })
          .catchError((Object _) {}),
    );
    FirebaseMessaging.onMessage.listen((message) {
      final voice = VoiceNotificationTarget.fromData(message.data);
      if (message.data['type'] == 'voice_message') {
        if (voice == null ||
            voice.recipientUid != FirebaseAuth.instance.currentUser?.uid) {
          return;
        }
        VoiceNotifications.received.add(voice);
        if (VoiceNotifications.activeConversation == voice.imei) return;
      }
      if (kIsWeb) return; // HomeShell renders an in-app voice banner on Web.
      final notification = message.notification;
      if (notification == null) return;
      final channel = voice == null ? _androidChannel : _messageChannel;
      _localNotifications.show(
        id: voice?.messageId.hashCode ?? notification.hashCode,
        title: notification.title,
        body: notification.body,
        payload: voice == null ? null : jsonEncode(message.data),
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            channel.id,
            channel.name,
            channelDescription: channel.description,
            importance: Importance.high,
            priority: Priority.high,
            visibility: NotificationVisibility.private,
            tag: voice?.messageId,
          ),
          iOS: const DarwinNotificationDetails(),
        ),
      );
    });
  }

  /// Requests notification permission and stores this device's FCM token on
  /// the signed-in user's profile so the gateway can push alerts to it.
  Future<void> registerForUser(String uid) async {
    _registeredUid = uid;
    await _tokenRefresh?.cancel();
    _tokenRefresh = null;
    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied ||
        _registeredUid != uid ||
        FirebaseAuth.instance.currentUser?.uid != uid) {
      return;
    }

    final token = await messaging.getToken();
    if (token != null) {
      await _saveToken(uid, token);
    }
    if (_registeredUid != uid ||
        FirebaseAuth.instance.currentUser?.uid != uid) {
      return;
    }
    _tokenRefresh = messaging.onTokenRefresh.listen((refreshed) {
      if (_registeredUid == uid &&
          FirebaseAuth.instance.currentUser?.uid == uid) {
        unawaited(_saveToken(uid, refreshed).catchError((Object _) {}));
      }
    });
  }

  Future<void> _saveToken(String uid, String token) async {
    if (_registeredUid != uid ||
        FirebaseAuth.instance.currentUser?.uid != uid) {
      return;
    }
    await _db.collection('users').doc(uid).set({
      'fcmTokens': FieldValue.arrayUnion([token]),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  /// Removes this device's token so it stops receiving pushes after sign-out.
  Future<void> unregisterForUser(String uid) async {
    if (_registeredUid == uid) {
      _registeredUid = null;
      await _tokenRefresh?.cancel();
      _tokenRefresh = null;
    }
    VoiceNotifications.opened.value = null;
    VoiceNotifications.activeConversation = null;
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null) return;
    await _db.collection('users').doc(uid).set({
      'fcmTokens': FieldValue.arrayRemove([token]),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }
}

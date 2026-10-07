import 'dart:async';
import 'package:flutter/foundation.dart';

class VoiceNotificationTarget {
  const VoiceNotificationTarget({
    required this.imei,
    required this.messageId,
    required this.recipientUid,
  });
  final String imei, messageId, recipientUid;
  bool canOpenFor(String? currentUid, String pilotImei) =>
      currentUid == recipientUid && imei == pilotImei;
  static VoiceNotificationTarget? fromData(Map<String, dynamic> data) {
    final imei = data['imei'],
        id = data['messageId'],
        uid = data['recipientUid'];
    if (data['type'] != 'voice_message' ||
        imei is! String ||
        !RegExp(r'^\d{15}$').hasMatch(imei) ||
        id is! String ||
        !RegExp(r'^in_[a-f0-9]{64}$').hasMatch(id) ||
        uid is! String ||
        !RegExp(r'^[^/\s]{1,128}$').hasMatch(uid)) {
      return null;
    }
    return VoiceNotificationTarget(
      imei: imei,
      messageId: id,
      recipientUid: uid,
    );
  }

  static VoiceNotificationTarget? fromUri(Uri uri, String uid) => fromData({
    'type': 'voice_message',
    'imei': uri.queryParameters['voiceImei'],
    'messageId': uri.queryParameters['voiceMessage'],
    'recipientUid': uid,
  });
}

/// Navigation hints only. Every history/audio read is reauthorized by the API.
class VoiceNotifications {
  static final opened = ValueNotifier<VoiceNotificationTarget?>(null);
  static final received = StreamController<VoiceNotificationTarget>.broadcast();
  static String? activeConversation;
}

import 'dart:convert';
import 'dart:typed_data';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

const voiceMessagesPilotImei = String.fromEnvironment(
  'GUARDIAN_VOICE_MESSAGES_PILOT_IMEI',
);

class VoiceMessageException implements Exception {
  const VoiceMessageException(this.code);
  final String code;
  bool get accessDenied => const [
    'feature_unavailable',
    'device_not_linked',
    'active_service_required',
    'sign_in_required',
  ].contains(code);
  String get message => switch (code) {
    'watch_offline' || 'watch_session_not_ready' =>
      'The watch is offline. Connect it before sending a message.',
    'camera_busy' =>
      'The watch is taking an incident photo. Please wait before sending.',
    'voice_busy' => 'Another voice message is in progress. Please wait.',
    'send_cooldown' => 'Please wait a minute between voice messages.',
    'delivery_unconfirmed' =>
      'The last send is unconfirmed. Sending is paused until it can be checked.',
    'message_in_progress' =>
      'A message is already being sent. Check its status below.',
    'daily_message_limit' => 'Today’s voice-message limit has been reached.',
    'message_unavailable' => 'This message has expired or was deleted.',
    'recording_processing_failed' =>
      'The recording could not be prepared. Please record it again.',
    'invalid_or_expired_request' =>
      'This recording could not be sent. Please record a new message.',
    'send_expired' => 'The send window expired. This message was not sent.',
    'sign_in_required' => 'Please sign in again to view voice messages.',
    'feature_unavailable' || 'device_not_linked' || 'active_service_required' =>
      'Voice messages are not available for this watch.',
    _ =>
      'Could not confirm the connection. Refresh to check the message status.',
  };
}

class VoiceMessage {
  const VoiceMessage({
    required this.id,
    required this.direction,
    required this.createdAt,
    required this.expiresAt,
    required this.durationMs,
    required this.status,
    this.played = false,
  });
  final String id, direction, status;
  final DateTime createdAt, expiresAt;
  final int durationMs;
  final bool played;
  bool get incoming => direction == 'incoming';
  bool get available =>
      expiresAt.isAfter(DateTime.now()) && status != 'expired';
  String get durationLabel => '${(durationMs / 1000).toStringAsFixed(1)} sec';
  String get statusLabel => switch (status) {
    'received' => played ? 'Played here' : 'New message',
    'reply_observed' => 'Watch replied',
    'preparing' || 'sending' => 'Waiting for watch reply…',
    'rejected' => 'Watch did not accept the message',
    'not_sent' => 'Not sent',
    'expired' => 'Expired',
    _ => 'Send unconfirmed',
  };
  factory VoiceMessage.fromJson(Map<String, dynamic> value) => VoiceMessage(
    id: value['id'] as String,
    direction: value['direction'] as String,
    createdAt: DateTime.fromMillisecondsSinceEpoch(value['createdAt'] as int),
    expiresAt: DateTime.fromMillisecondsSinceEpoch(value['expiresAt'] as int),
    durationMs: value['durationMs'] as int,
    status: value['status'] as String,
    played: value['played'] == true,
  );
}

class VoiceInbox {
  const VoiceInbox({
    this.messages = const [],
    this.connected = false,
    this.sendingBlocked = false,
    this.nextSendAt,
    this.maxSeconds = 30,
  });
  final List<VoiceMessage> messages;
  final bool connected, sendingBlocked;
  final DateTime? nextSendAt;
  final int maxSeconds;
  int get unread =>
      messages.where((m) => m.incoming && !m.played && m.available).length;
  bool get coolingDown => nextSendAt?.isAfter(DateTime.now()) == true;
  factory VoiceInbox.fromJson(Map<String, dynamic> v) => VoiceInbox(
    messages: (v['messages'] as List)
        .map((e) => VoiceMessage.fromJson(e as Map<String, dynamic>))
        .toList(),
    connected: v['connected'] == true,
    sendingBlocked: v['sendingBlocked'] == true,
    nextSendAt: DateTime.fromMillisecondsSinceEpoch(
      v['nextSendAt'] as int? ?? 0,
    ),
    maxSeconds: (v['maxSeconds'] as int? ?? 30).clamp(1, 30),
  );
}

abstract class VoiceMessagesClient {
  Stream<void> get accessChanges;
  Future<VoiceInbox> load(String imei);
  Future<VoiceMessage> send(
    String imei, {
    required String id,
    required Uint8List pcm,
    required DateTime createdAt,
  });
  Future<Uint8List> audio(String imei, String id);
  Future<void> played(String imei, String id);
  Future<void> delete(String imei, String id);
  void close();
}

class VoiceMessagesService implements VoiceMessagesClient {
  VoiceMessagesService({
    http.Client? client,
    Future<String?> Function()? token,
    this.gatewayUrl = const String.fromEnvironment('GUARDIAN_GATEWAY_URL'),
  }) : _client = client ?? http.Client(),
       _token =
           token ??
           (() async => FirebaseAuth.instance.currentUser?.getIdToken());
  final http.Client _client;
  final Future<String?> Function() _token;
  final String gatewayUrl;
  @override
  Stream<void> get accessChanges =>
      FirebaseAuth.instance.idTokenChanges().map((_) {});
  Uri _uri(String imei, String path, String? id) {
    final base = Uri.tryParse(gatewayUrl);
    final local =
        base?.scheme == 'http' &&
        ['localhost', '127.0.0.1'].contains(base?.host);
    if (base == null ||
        base.host.isEmpty ||
        (base.scheme != 'https' && !local) ||
        base.userInfo.isNotEmpty ||
        base.hasQuery ||
        base.hasFragment ||
        (base.path.isNotEmpty && base.path != '/')) {
      throw const VoiceMessageException('gateway_not_configured');
    }
    return base.replace(
      path: '/app/voice-messages$path',
      queryParameters: {'imei': imei, 'id': ?id},
    );
  }

  Future<http.Response> _request(
    String imei, {
    String path = '',
    String? id,
    Map<String, dynamic>? body,
  }) async {
    final uri = _uri(imei, path, id), token = await _token();
    if (token == null) throw const VoiceMessageException('sign_in_required');
    final headers = {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    };
    // A timeout can follow delivery. Never replay a recording automatically.
    final response =
        await (body == null
                ? _client.get(uri, headers: headers)
                : _client.post(uri, headers: headers, body: jsonEncode(body)))
            .timeout(const Duration(seconds: 25));
    if (response.statusCode != 200) {
      String? code;
      try {
        code =
            (jsonDecode(response.body) as Map<String, dynamic>)['error']
                as String?;
      } catch (_) {}
      throw VoiceMessageException(code ?? 'gateway_unavailable');
    }
    return response;
  }

  @override
  Future<VoiceInbox> load(String imei) async => VoiceInbox.fromJson(
    jsonDecode((await _request(imei)).body) as Map<String, dynamic>,
  );
  @override
  Future<VoiceMessage> send(
    String imei, {
    required String id,
    required Uint8List pcm,
    required DateTime createdAt,
  }) async => VoiceMessage.fromJson(
    (jsonDecode(
              (await _request(
                imei,
                body: {
                  'id': id,
                  'pcm': base64Encode(pcm),
                  'createdAt': createdAt.millisecondsSinceEpoch,
                },
              )).body,
            )
            as Map<String, dynamic>)['message']
        as Map<String, dynamic>,
  );
  @override
  Future<Uint8List> audio(String imei, String id) async =>
      (await _request(imei, path: '/audio', id: id)).bodyBytes;
  @override
  Future<void> played(String imei, String id) async {
    await _request(imei, path: '/played', id: id, body: {});
  }

  @override
  Future<void> delete(String imei, String id) async {
    await _request(imei, path: '/delete', id: id, body: {});
  }

  @override
  void close() => _client.close();
}

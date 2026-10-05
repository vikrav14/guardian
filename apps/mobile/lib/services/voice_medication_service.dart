import 'dart:convert';
import 'dart:typed_data';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

const voiceMedicationPilotImei = String.fromEnvironment(
  'GUARDIAN_VOICE_MEDICATION_PILOT_IMEI',
);

class VoiceMedicationException implements Exception {
  const VoiceMedicationException(this.code);
  final String code;
  String get message => switch (code) {
    'watch_offline' || 'watch_session_not_ready' =>
      'The watch is offline. Connect it before saving again.',
    'camera_busy' =>
      'The watch is taking an incident photo. This reminder was not sent.',
    'watch_slots_full' =>
      'The watch has three reminder slots. Edit an existing reminder.',
    'slot_conflict' =>
      'Existing reminders share a watch slot. Resolve that conflict before changing this reminder.',
    'settings_changed' =>
      'This reminder changed. Close and reopen it to use the latest settings.',
    'change_in_progress' || 'legacy_change_pending' =>
      'Another watch setting is still in progress. Check its result first.',
    'recording_required' => 'Record a short voice reminder first.',
    'recording_processing_failed' =>
      'This recording could not be prepared. Please record it again.',
    'turn_off_before_retry' => 'The earlier change was not confirmed. Turn the reminder off and confirm the reply before enabling it again.',
    'reconnect_required' =>
      'The last reply was unclear. Reconnect the watch before another enable. Turning it off is still available.',
    'sign_in_required' => 'Please sign in again.',
    'feature_unavailable' =>
      'Voice reminders are not available on this gateway yet.',
    _ =>
      'Could not confirm this change. Check the reminder status before trying again.',
  };
}

class VoiceMedicationReminder {
  const VoiceMedicationReminder({
    required this.id,
    required this.time,
    required this.text,
    this.frequency = 1,
    this.slot = 1,
    this.enabled = true,
    this.mode = 'alert',
    this.version = 0,
    this.status = 'unknown',
    this.reason,
    this.durationMs = 0,
    this.managed = false,
    this.deleted = false,
  });
  final String id, time, text, mode, status;
  final int frequency, slot, version, durationMs;
  final bool enabled, managed, deleted;
  final String? reason;
  factory VoiceMedicationReminder.fromJson(Map<String, dynamic> v) =>
      VoiceMedicationReminder(
        id: v['id'] as String,
        time: v['time'] as String,
        text: v['text'] as String,
        frequency: v['frequency'] as int,
        slot: v['slot'] as int? ?? v['frequency'] as int,
        enabled: v['enabled'] == true,
        mode: v['mode'] as String? ?? 'alert',
        version: v['version'] as int? ?? 0,
        status: v['status'] as String? ?? 'unknown',
        reason: v['reason'] as String?,
        durationMs: v['durationMs'] as int? ?? 0,
        managed: v['managed'] == true,
        deleted: v['deleted'] == true,
      );
  String get statusLabel => switch (status) {
    'reply_observed' => 'Watch replied',
    'waiting' => 'Waiting to send',
    'sending' => 'Waiting for the watch’s reply',
    'not_sent' => 'Not sent to the watch',
    'rejected' => 'Watch did not accept this change',
    'sent' => 'Sent • reply not verified',
    _ => 'Watch setting not confirmed',
  };
}

abstract class VoiceMedicationClient {
  Future<List<VoiceMedicationReminder>> load(String imei);
  Future<VoiceMedicationReminder> save(String imei, Map<String, dynamic> body);
  Future<Uint8List> audio(String imei, String id);
  void close();
}

class VoiceMedicationService implements VoiceMedicationClient {
  VoiceMedicationService({
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
  Uri _uri(String imei, {String? id}) {
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
      throw const VoiceMedicationException('gateway_not_configured');
    }
    return base.replace(
      path: '/app/medication-reminders${id == null ? '' : '/audio'}',
      queryParameters: {'imei': imei, 'id': ?id},
    );
  }

  Future<http.Response> _request(
    String imei, {
    Map<String, dynamic>? body,
    String? id,
  }) async {
    final uri = _uri(imei), token = await _token();
    if (token == null) throw const VoiceMedicationException('sign_in_required');
    final headers = {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    };
    // A timeout may follow a delivered setting. Never retry automatically.
    final response =
        await (body == null
                ? _client.get(uri, headers: headers)
                : _client.post(uri, headers: headers, body: jsonEncode(body)))
            .timeout(const Duration(seconds: 50));
    if (response.statusCode != 200) {
      String? code;
      try {
        code =
            (jsonDecode(response.body) as Map<String, dynamic>)['error']
                as String?;
      } catch (_) {}
      throw VoiceMedicationException(code ?? 'gateway_unavailable');
    }
    return response;
  }

  @override
  Future<List<VoiceMedicationReminder>> load(String imei) async =>
      ((jsonDecode((await _request(imei)).body)
                  as Map<String, dynamic>)['reminders']
              as List)
          .map(
            (e) => VoiceMedicationReminder.fromJson(e as Map<String, dynamic>),
          )
          .toList();
  @override
  Future<VoiceMedicationReminder> save(
    String imei,
    Map<String, dynamic> body,
  ) async => VoiceMedicationReminder.fromJson(
    (jsonDecode((await _request(imei, body: body)).body)
            as Map<String, dynamic>)['reminder']
        as Map<String, dynamic>,
  );
  @override
  Future<Uint8List> audio(String imei, String id) async =>
      (await _request(imei, id: id)).bodyBytes;
  @override
  void close() => _client.close();
}

import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import '../models/safety_snapshot.dart';

const guardianSnapshotGatewayUrl = String.fromEnvironment(
  'GUARDIAN_GATEWAY_URL',
);
const guardianSafetySnapshotsEnabled = bool.fromEnvironment(
  'GUARDIAN_SAFETY_SNAPSHOTS_ENABLED',
  defaultValue: true,
);
bool get guardianSnapshotAppConfigured =>
    guardianSafetySnapshotsEnabled && guardianSnapshotGatewayUrl.isNotEmpty;

class SnapshotFailure implements Exception {
  const SnapshotFailure(this.code);
  final String code;

  String get message => switch (code) {
    'watch_offline_or_reconnecting' || 'watch_disconnected' =>
      'The watch is offline or reconnecting. Try again when it is connected.',
    'cooldown_active' => 'Please wait before requesting another photo.',
    'camera_unavailable' => 'Photos are not available for this watch yet.',
    'photo_unavailable' || 'photo_not_found' =>
      'This photo has expired or been deleted.',
    'sign_in_required' => 'Please sign in again to access photos.',
    'family_plan_required' || 'device_not_linked' ||
    'family_membership_not_verified' =>
      'Photo access could not be verified for this watch.',
    'consent_and_purpose_required' =>
      'Confirm permission and enter a short reason for this photo.',
    _ => 'Could not reach the photo service. Check your connection and retry.',
  };
}

class SnapshotFeed {
  const SnapshotFeed({required this.items, required this.cameraAvailable,
    required this.online, this.retryAt});
  final List<SafetySnapshot> items;
  final bool cameraAvailable;
  final bool online;
  final DateTime? retryAt;
}

class SafetySnapshotService {
  SafetySnapshotService({http.Client? client, Future<String?> Function()? token,
    String baseUrl = guardianSnapshotGatewayUrl})
      : _client = client ?? http.Client(),
        _token = token ?? (() async => FirebaseAuth.instance.currentUser?.getIdToken()),
        _base = Uri.parse(baseUrl);

  final http.Client _client;
  final Future<String?> Function() _token;
  final Uri _base;

  Future<http.Response> _request(String method, String path,
      {Map<String, String>? query, Map<String, dynamic>? body}) async {
    if (_base.scheme != 'https' &&
        !(_base.scheme == 'http' && ['localhost', '127.0.0.1'].contains(_base.host))) {
      throw const SnapshotFailure('camera_unavailable');
    }
    final token = await _token();
    if (token == null) throw const SnapshotFailure('sign_in_required');
    final request = http.Request(method, _base.replace(path: path, queryParameters: query))
      ..headers.addAll({'Authorization': 'Bearer $token',
        'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1'});
    if (body != null) request.body = jsonEncode(body);
    // A timeout never retries a camera request automatically.
    final response = await http.Response.fromStream(
      await _client.send(request).timeout(const Duration(seconds: 20)),
    ).timeout(const Duration(seconds: 20));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String code = 'photo_service_error';
      try { code = (jsonDecode(response.body) as Map<String, dynamic>)['error'] as String? ?? code; }
      on FormatException { /* An unavailable tunnel may return HTML. */ }
      throw SnapshotFailure(code);
    }
    return response;
  }

  Future<SnapshotFeed> load(String imei) async {
    final response = await _request('GET', '/api/safety-snapshots', query: {'imei': imei});
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return SnapshotFeed(
      items: (data['snapshots'] as List<dynamic>).map((raw) {
        final row = raw as Map<String, dynamic>;
        return SafetySnapshot.fromFirestore(row['id'] as String, row);
      }).toList(),
      cameraAvailable: data['cameraAvailable'] == true, online: data['online'] == true,
      retryAt: DateTime.tryParse(data['retryAt'] as String? ?? ''),
    );
  }

  Future<String> requestSnapshot({required String imei, required String purpose,
    required bool consentConfirmed, required bool safetyPurposeConfirmed}) async {
    final response = await _request('POST', '/api/safety-snapshots', body: {
      'imei': imei, 'purpose': purpose, 'consentConfirmed': consentConfirmed,
      'safetyPurposeConfirmed': safetyPurposeConfirmed,
    });
    return (jsonDecode(response.body) as Map<String, dynamic>)['requestId'] as String;
  }

  Future<Uint8List> loadImage(String id) async {
    final response = await _request('GET', '/api/safety-snapshots/$id/image');
    if (response.headers['content-type'] != 'image/jpeg' || response.bodyBytes.length > 65536) {
      throw const SnapshotFailure('photo_unavailable');
    }
    return response.bodyBytes;
  }

  Future<void> delete(String id) async {
    await _request('DELETE', '/api/safety-snapshots/$id');
  }

  void dispose() => _client.close();
}

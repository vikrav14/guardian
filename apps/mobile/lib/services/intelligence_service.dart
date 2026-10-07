import 'dart:async';
import 'dart:convert';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

const guardianIntelligenceEnabled = bool.fromEnvironment(
  'GUARDIAN_INTELLIGENCE_ENABLED',
);

class IntelligenceException implements Exception {
  const IntelligenceException(this.code);
  final String code;
  String get message => switch (code) {
    'access_not_shared' || 'access_changed' || 'active_service_required' =>
      'This overview is not available with your current access.',
    'sign_in_required' => 'Please sign in again to view this overview.',
    'please_wait' => 'Please wait a moment before refreshing again.',
    _ =>
      'The overview is unavailable. Your watch details and alerts are still in their usual places.',
  };
}

class IntelligenceFact {
  const IntelligenceFact({
    required this.id,
    required this.text,
    required this.source,
    required this.screen,
    this.targetId,
    this.recordedAt,
  });
  final String id, text, source, screen;
  final String? targetId;
  final DateTime? recordedAt;
  bool get isPhotoObservation => source == 'photo_ai';
  factory IntelligenceFact.fromJson(Map<String, dynamic> value) {
    final target = value['target'] as Map?;
    return IntelligenceFact(
      id: value['id'] as String,
      text: value['text'] as String,
      source: value['source'] as String,
      screen: target?['screen'] as String? ?? '',
      targetId: target?['id'] as String?,
      recordedAt: value['recordedAt'] is num
          ? DateTime.fromMillisecondsSinceEpoch(
              (value['recordedAt'] as num).toInt(),
            )
          : null,
    );
  }
}

class IntelligenceAnswer {
  const IntelligenceAnswer({
    required this.asOf,
    required this.validUntil,
    required this.mode,
    required this.facts,
    required this.gaps,
    required this.suggestions,
    this.message,
    this.reason,
  });
  final DateTime asOf, validUntil;
  final String mode;
  final List<IntelligenceFact> facts;
  final List<String> gaps, suggestions;
  final String? message, reason;
  bool get expired => !validUntil.isAfter(DateTime.now());
  String get basis => mode == 'ai_selected'
      ? 'AI-assisted answer from your records'
      : 'From recorded information';
  factory IntelligenceAnswer.fromJson(
    Map<String, dynamic> value,
  ) => IntelligenceAnswer(
    asOf: DateTime.fromMillisecondsSinceEpoch(value['asOf'] as int),
    validUntil: DateTime.fromMillisecondsSinceEpoch(value['validUntil'] as int),
    mode: value['mode'] as String,
    facts: (value['facts'] as List)
        .map(
          (e) => IntelligenceFact.fromJson(Map<String, dynamic>.from(e as Map)),
        )
        .toList(),
    gaps: List<String>.from(value['gaps'] as List),
    suggestions: List<String>.from(value['suggestions'] as List),
    message: value['message'] as String?,
    reason: value['reason'] as String?,
  );
}

abstract class IntelligenceClient {
  Stream<void> accessChanges(String imei);
  Future<IntelligenceAnswer> load(String imei, {String? incidentId});
  void close();
}

class IntelligenceService implements IntelligenceClient {
  IntelligenceService({
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
  Stream<void> accessChanges(String imei) {
    late StreamController<void> controller;
    StreamSubscription<dynamic>? auth, service;
    controller = StreamController<void>(
      onListen: () {
        auth = FirebaseAuth.instance.idTokenChanges().listen(
          (_) => controller.add(null),
        );
        service = FirebaseFirestore.instance
            .collection('familyServices')
            .doc(imei)
            .snapshots()
            .listen(
              (_) => controller.add(null),
              onError: (Object _) => controller.add(null),
            );
      },
      onCancel: () async {
        await auth?.cancel();
        await service?.cancel();
      },
    );
    return controller.stream;
  }

  Future<IntelligenceAnswer> _request(String imei, {String? incidentId}) async {
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
      throw const IntelligenceException('gateway_not_configured');
    }
    final token = await _token();
    if (token == null) throw const IntelligenceException('sign_in_required');
    final uri = base.replace(
      path: '/app/intelligence',
      queryParameters: {'imei': imei, 'incidentId': ?incidentId},
    );
    final headers = {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    };
    final response = await _client
        .get(uri, headers: headers)
        .timeout(const Duration(seconds: 20));
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode != 200) {
      throw IntelligenceException(data['error'] as String? ?? 'unavailable');
    }
    return IntelligenceAnswer.fromJson(data);
  }

  @override
  Future<IntelligenceAnswer> load(String imei, {String? incidentId}) =>
      _request(imei, incidentId: incidentId);
  @override
  void close() => _client.close();
}

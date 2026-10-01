import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class HomeWifiException implements Exception {
  const HomeWifiException(this.code);
  final String code;
}

class HomeWifiNetwork {
  const HomeWifiNetwork({
    required this.id,
    required this.name,
    required this.radioHint,
    required this.signalDbm,
    required this.observedAt,
    required this.expiresAt,
  });
  final String id;
  final String name;
  final String radioHint;
  final int signalDbm;
  final DateTime observedAt;
  final DateTime expiresAt;
  bool fresh(DateTime now) =>
      !observedAt.isAfter(now) && expiresAt.isAfter(now);
  factory HomeWifiNetwork.fromJson(Map<String, dynamic> json) =>
      HomeWifiNetwork(
        id: json['id'] as String,
        name: json['name'] as String,
        radioHint: json['radioHint'] as String,
        signalDbm: json['signalDbm'] as int,
        observedAt: DateTime.parse(json['observedAt'] as String),
        expiresAt: DateTime.parse(json['expiresAt'] as String),
      );
}

class HomeWifiState {
  const HomeWifiState({
    required this.version,
    required this.enabled,
    required this.connected,
    required this.networks,
    this.name,
    this.homeKey,
    this.homeProblem,
    this.lat,
    this.lng,
    this.radiusMeters,
    this.detectedNow = false,
    this.observedAt,
  });
  final int version;
  final bool enabled;
  final bool connected;
  final String? name;
  final String? homeKey;
  final String? homeProblem;
  final double? lat;
  final double? lng;
  final double? radiusMeters;
  final bool detectedNow;
  final DateTime? observedAt;
  final List<HomeWifiNetwork> networks;
  factory HomeWifiState.fromJson(Map<String, dynamic> json) {
    final saved = json['saved'] as Map<String, dynamic>;
    final home = json['home'] as Map<String, dynamic>?;
    return HomeWifiState(
      version: saved['version'] as int,
      enabled: saved['enabled'] == true,
      name: saved['name'] as String?,
      connected: json['connected'] == true,
      homeKey: json['homeKey'] as String?,
      homeProblem: json['homeProblem'] as String?,
      lat: (home?['lat'] as num?)?.toDouble(),
      lng: (home?['lng'] as num?)?.toDouble(),
      radiusMeters: (home?['radiusMeters'] as num?)?.toDouble(),
      detectedNow: json['detectedNow'] == true,
      observedAt: DateTime.tryParse(json['observedAt'] as String? ?? ''),
      networks: (json['networks'] as List? ?? [])
          .map((e) => HomeWifiNetwork.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

abstract class HomeWifiClient {
  Future<HomeWifiState> load(String imei, String geofenceId);
  Future<void> save(
    String imei,
    String geofenceId, {
    required String candidateId,
    required int expectedVersion,
    required String homeKey,
  });
  Future<void> remove(String imei, {required int expectedVersion});
  void close();
}

class HomeWifiService implements HomeWifiClient {
  HomeWifiService({
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
  Uri _uri(String imei, String? geofenceId) {
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
      throw const HomeWifiException('gateway_not_configured');
    }
    return base.replace(
      path: '/app/home-wifi',
      queryParameters: {
        'imei': imei,
        if (geofenceId != null) 'geofenceId': geofenceId,
      },
    );
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String imei, {
    String? geofenceId,
    Map<String, dynamic>? body,
  }) async {
    final uri = _uri(imei, geofenceId);
    final token = await _token();
    if (token == null || token.isEmpty)
      throw const HomeWifiException('sign_in_required');
    final request = http.Request(method, uri)
      ..headers.addAll({
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      });
    if (body != null) request.body = jsonEncode(body);
    // Saving is never retried automatically: read the revision after a timeout.
    final response = await _client
        .send(request)
        .then(http.Response.fromStream)
        .timeout(const Duration(seconds: 20));
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode != 200)
      throw HomeWifiException(json['error'] as String? ?? 'setup_unavailable');
    return json;
  }

  @override
  Future<HomeWifiState> load(String imei, String geofenceId) async =>
      HomeWifiState.fromJson(
        await _request('GET', imei, geofenceId: geofenceId),
      );
  @override
  Future<void> save(
    String imei,
    String geofenceId, {
    required String candidateId,
    required int expectedVersion,
    required String homeKey,
  }) async {
    await _request(
      'POST',
      imei,
      body: {
        'candidateId': candidateId,
        'expectedVersion': expectedVersion,
        'geofenceId': geofenceId,
        'homeKey': homeKey,
      },
    );
  }

  @override
  Future<void> remove(String imei, {required int expectedVersion}) async {
    await _request('DELETE', imei, body: {'expectedVersion': expectedVersion});
  }

  @override
  void close() => _client.close();
}

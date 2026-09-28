import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import 'guardian_entitlements.dart';

const guardianMovementReminderPilotImei = String.fromEnvironment(
  'GUARDIAN_MOVEMENT_REMINDER_PILOT_IMEI',
);

bool canUseMovementPilot(
  GuardianSubscription subscription,
  String imei, {
  String pilotImei = guardianMovementReminderPilotImei,
  DateTime? now,
}) =>
    RegExp(r'^\d{15}$').hasMatch(pilotImei) &&
    imei == pilotImei &&
    subscription.serviceActive &&
    [GuardianPlan.family, GuardianPlan.care].contains(subscription.plan) &&
    (subscription.accessUntil == null ||
        subscription.accessUntil!.isAfter(now ?? DateTime.now()));

class MovementSettings {
  const MovementSettings({
    required this.enabled,
    required this.start,
    required this.end,
  });
  final bool enabled;
  final String start;
  final String end;

  Map<String, dynamic> toJson() => {
    'enabled': enabled,
    'intervalMinutes': 20,
    'start': start,
    'end': end,
    'timezone': 'Indian/Mauritius',
  };

  factory MovementSettings.fromJson(Map<String, dynamic> value) =>
      MovementSettings(
        enabled: value['enabled'] == true,
        start: value['start'] as String,
        end: value['end'] as String,
      );
}

class MovementState {
  const MovementState({
    this.version = 0,
    this.status = 'not_checked',
    this.reason,
    this.desired,
    this.connected = false,
  });
  final int version;
  final String status;
  final String? reason;
  final MovementSettings? desired;
  final bool connected;

  factory MovementState.fromJson(Map<String, dynamic> value) => MovementState(
    version: value['version'] as int? ?? 0,
    status: value['status'] as String? ?? 'not_checked',
    reason: value['reason'] as String?,
    desired: value['desired'] is Map<String, dynamic>
        ? MovementSettings.fromJson(value['desired'] as Map<String, dynamic>)
        : null,
    connected: value['connected'] == true,
  );
}

class MovementRequestException implements Exception {
  const MovementRequestException(this.code);
  final String code;
}

abstract class MovementReminderClient {
  Future<MovementState> load(String imei);
  Future<MovementState> save(
    String imei, {
    required String requestId,
    required int expectedVersion,
    required MovementSettings settings,
  });
}

class MovementRemindersService implements MovementReminderClient {
  MovementRemindersService({
    http.Client? client,
    Future<String?> Function()? token,
    String gatewayUrl = const String.fromEnvironment('GUARDIAN_GATEWAY_URL'),
  }) : _client = client ?? http.Client(),
       _token = token ?? (() async {
         final user = FirebaseAuth.instance.currentUser;
         return user == null ? null : await user.getIdToken();
       }),
       _gatewayUrl = gatewayUrl;

  final http.Client _client;
  final Future<String?> Function() _token;
  final String _gatewayUrl;

  void close() => _client.close();

  Uri _uri(String imei) {
    final base = Uri.tryParse(_gatewayUrl);
    final local = base?.scheme == 'http' &&
        ['localhost', '127.0.0.1'].contains(base?.host);
    if (base == null || base.host.isEmpty ||
        (base.scheme != 'https' && !local) || base.userInfo.isNotEmpty ||
        base.hasQuery || base.hasFragment ||
        (base.path.isNotEmpty && base.path != '/')) {
      throw const MovementRequestException('gateway_not_configured');
    }
    return base.replace(path: '/app/movement-reminders', queryParameters: {'imei': imei});
  }

  Future<MovementState> _request(String imei, Map<String, dynamic>? body) async {
    final uri = _uri(imei);
    final token = await _token();
    if (token == null || token.isEmpty) {
      throw const MovementRequestException('sign_in_required');
    }
    final headers = {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    };
    // No retry: a network timeout can occur after a watch command was sent.
    final response = await (body == null
            ? _client.get(uri, headers: headers)
            : _client.post(uri, headers: headers, body: jsonEncode(body)))
        .timeout(const Duration(seconds: 40));
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode != 200) {
      throw MovementRequestException(data['error'] as String? ?? 'gateway_unavailable');
    }
    return MovementState.fromJson(data);
  }

  @override
  Future<MovementState> load(String imei) => _request(imei, null);

  @override
  Future<MovementState> save(
    String imei, {
    required String requestId,
    required int expectedVersion,
    required MovementSettings settings,
  }) => _request(imei, {
    'requestId': requestId,
    'expectedVersion': expectedVersion,
    'settings': settings.toJson(),
  });
}

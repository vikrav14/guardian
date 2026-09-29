import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/services/movement_reminders_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const imei = '999999999999999';
void main() {
  test('pilot visibility is explicit, device scoped, and requires active service', () {
    final family = GuardianSubscription.fromMap({
      'version': 1, 'managedBy': 'guardian_admin', 'plan': 'family', 'status': 'active',
    });
    expect(canUseMovementPilot(family, imei), isFalse);
    expect(canUseMovementPilot(family, imei, pilotImei: imei), isTrue);
    expect(canUseMovementPilot(family, '111111111111111', pilotImei: imei), isFalse);
    expect(canUseMovementPilot(const GuardianSubscription.inactive(), imei, pilotImei: imei), isFalse);
  });

  test('save sends Firebase identity, expected version and interval contract once', () async {
    var requests = 0;
    final client = MockClient((request) async {
      requests++;
      expect(request.method, 'POST');
      expect(request.headers['Authorization'], 'Bearer test-token');
      expect(request.headers.containsKey('X-Admin-Key'), isFalse);
      expect(request.url.queryParameters['imei'], imei);
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body['expectedVersion'], 2);
      expect(body['requestId'], 'test-id');
      expect(body['action'], 'switch');
      expect(body['settings']['intervalMinutes'], 20);
      expect(body['settings'].containsKey('localTime'), isFalse);
      return http.Response('{"version":3,"status":"replies_observed","connected":true}', 200);
    });
    final service = MovementRemindersService(client: client, token: () async => 'test-token', gatewayUrl: 'https://gateway.example');
    final result = await service.save(imei, requestId: 'test-id', expectedVersion: 2,
      settings: const MovementSettings(enabled: true, start: '08:00', end: '20:00'), action: 'switch');
    expect(result.status, 'replies_observed');
    expect(requests, 1);
    service.close();
  });

  test('failed POST is never automatically replayed', () async {
    var requests = 0;
    final service = MovementRemindersService(
      client: MockClient((request) async { requests++; throw http.ClientException('lost'); }),
      token: () async => 'test-token', gatewayUrl: 'https://gateway.example',
    );
    await expectLater(service.save(imei, requestId: 'test-id', expectedVersion: 0,
      settings: const MovementSettings(enabled: true, start: '08:00', end: '20:00'), action: 'switch'), throwsA(isA<http.ClientException>()));
    expect(requests, 1);
    service.close();
  });

  test('missing sign-in and unsafe gateway URL make no HTTP call', () async {
    final client = MockClient((_) async => throw StateError('Must not call'));
    for (final url in ['http://public.example', '', 'https://user:secret@example.com']) {
      final service = MovementRemindersService(client: client, token: () async => 'token', gatewayUrl: url);
      await expectLater(service.load(imei), throwsA(isA<MovementRequestException>()));
    }
    final service = MovementRemindersService(client: client, token: () async => null, gatewayUrl: 'https://gateway.example');
    await expectLater(service.load(imei), throwsA(isA<MovementRequestException>()));
    client.close();
  });

  test('partial requested state is readable without claiming unsent hours', () {
    final state = MovementState.fromJson({
      'action': 'switch', 'desired': {'enabled': true, 'intervalMinutes': 20},
    });
    expect(state.desired!.enabled, isTrue);
    expect(state.action, 'switch');
    expect(state.hoursRequested, isFalse);
    expect(state.desired!.start, '08:00');
  });
}

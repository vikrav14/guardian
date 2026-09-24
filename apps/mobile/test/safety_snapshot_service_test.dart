import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:guardian/services/safety_snapshot_service.dart';

void main() {
  test(
    'one explicit request uses Firebase bearer token and consent, without retry',
    () async {
      var requests = 0;
      final service = SafetySnapshotService(
        baseUrl: 'https://gateway.example',
        token: () async => 'token',
        client: MockClient((request) async {
          requests++;
          expect(request.headers['Authorization'], 'Bearer token');
          final data = jsonDecode(request.body) as Map<String, dynamic>;
          expect(data['consentConfirmed'], isTrue);
          expect(data['imei'], '861397052547492');
          return http.Response('{"requestId":"one"}', 202);
        }),
      );
      addTearDown(service.dispose);
      expect(
        await service.requestSnapshot(
          imei: '861397052547492',
          purpose: 'Check surroundings',
          consentConfirmed: true,
          safetyPurposeConfirmed: true,
        ),
        'one',
      );
      expect(requests, 1);
    },
  );

  test(
    'failed requests are not replayed and structured rejection reaches the app',
    () async {
      var requests = 0;
      final service = SafetySnapshotService(
        baseUrl: 'https://gateway.example',
        token: () async => 'token',
        client: MockClient((_) async {
          requests++;
          return http.Response('{"error":"cooldown_active"}', 429);
        }),
      );
      addTearDown(service.dispose);
      await expectLater(
        service.requestSnapshot(
          imei: '861397052547492',
          purpose: 'Check surroundings',
          consentConfirmed: true,
          safetyPurposeConfirmed: true,
        ),
        throwsA(isA<SnapshotFailure>()),
      );
      expect(requests, 1);
    },
  );

  test(
    'private bytes require an authenticated image response; tunnel HTML is rejected',
    () async {
      final service = SafetySnapshotService(
        baseUrl: 'https://gateway.example',
        token: () async => 'token',
        client: MockClient(
          (_) async => http.Response(
            '<html>offline</html>',
            200,
            headers: {'content-type': 'text/html'},
          ),
        ),
      );
      addTearDown(service.dispose);
      await expectLater(
        service.loadImage('one'),
        throwsA(isA<SnapshotFailure>()),
      );
    },
  );

  test(
    'cleartext external hosts and signed-out users never send credentials',
    () async {
      var requests = 0;
      final client = MockClient((_) async {
        requests++;
        return http.Response('{}', 200);
      });
      final insecure = SafetySnapshotService(
        baseUrl: 'http://outside.example',
        token: () async => 'token',
        client: client,
      );
      await expectLater(
        insecure.load('861397052547492'),
        throwsA(isA<SnapshotFailure>()),
      );
      final signedOut = SafetySnapshotService(
        baseUrl: 'https://gateway.example',
        token: () async => null,
        client: client,
      );
      await expectLater(
        signedOut.load('861397052547492'),
        throwsA(isA<SnapshotFailure>()),
      );
      expect(requests, 0);
      client.close();
    },
  );
}

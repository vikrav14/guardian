import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:guardian/models/incident_photos.dart';
import 'package:guardian/screens/incident_photo_page.dart';
import 'package:guardian/services/safety_snapshot_service.dart';
import 'package:guardian/widgets/dashboard/incident_photo_action.dart';

class WindowService extends SafetySnapshotService {
  WindowService()
    : super(baseUrl: 'https://gateway.example', token: () async => 'token');
  bool open = true, pending = false, denied = false, ambiguous = false;
  String? blockedReason;
  Completer<String>? send;
  final keys = <String>[];
  IncidentPhotoAccess get access => IncidentPhotoAccess(
    canRequest: open && !pending && blockedReason == null,
    incidentId: 'incident-one',
    reason: blockedReason ?? (pending ? 'camera_busy' : null),
    endsAt: DateTime.now().add(Duration(minutes: open ? 47 : -1)),
  );
  @override
  Future<IncidentPhotoAccess> activeIncident(String imei) async {
    if (denied) throw const SnapshotFailure('photo_service_unreachable');
    return access;
  }

  @override
  Future<IncidentPhotoFeed> loadIncident(String id) async {
    if (denied) throw const SnapshotFailure('family_membership_not_verified');
    return IncidentPhotoFeed(
      type: 'fall',
      state: 'stopped',
      photos: const [],
      photoAccess: access,
    );
  }

  @override
  Future<String> requestIncidentPhoto(
    String incidentId,
    String requestKey,
  ) async {
    keys.add(requestKey);
    if (ambiguous) throw const SnapshotFailure('request_status_unknown');
    if (send != null) return send!.future;
    pending = true;
    return 'request-one';
  }
}

void main() {
  testWidgets(
    'Home opens the incident while its automatic photo is still pending',
    (tester) async {
      final service = WindowService()..pending = true;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: IncidentPhotoAction(imei: 'watch-one', service: service),
          ),
        ),
      );
      await tester.pump();
      expect(
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
        isNotNull,
      );
      expect(find.textContaining('47 min left'), findsOneWidget);
      expect(
        service.keys,
        isEmpty,
        reason: 'Checking or opening access never captures',
      );
      await tester.pumpWidget(const SizedBox());
      service.dispose();
    },
  );
  testWidgets(
    'service disabled state explains the grey button and unlocks on refreshed access',
    (tester) async {
      final service = WindowService()
        ..blockedReason = 'photo_feature_unavailable';
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: IncidentPhotoAction(imei: 'watch-one', service: service),
          ),
        ),
      );
      await tester.pump();
      expect(
        find.text('Photo requests are not enabled on the service yet.'),
        findsOneWidget,
      );
      expect(
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
        isNull,
      );
      service.blockedReason = null;
      await tester.pump(const Duration(seconds: 15));
      await tester.pump();
      expect(
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
        isNotNull,
      );
      expect(service.keys, isEmpty);
      await tester.pumpWidget(const SizedBox());
      service.dispose();
    },
  );
  test(
    'legacy incident and withdrawn permission never promise an available photo window',
    () {
      for (final reason in [
        'photo_window_not_enabled_for_incident',
        'capture_disabled',
      ]) {
        final access = IncidentPhotoAccess(
          canRequest: true,
          reason: reason,
          endsAt: DateTime.now().add(const Duration(minutes: 30)),
        );
        expect(access.windowOpen, isFalse);
        expect(access.message, isNot(contains('Available for one hour')));
      }
    },
  );
  test('request window uses server time despite wrong phone clock', () {
    final server = DateTime.now().subtract(const Duration(days: 2));
    final access = IncidentPhotoAccess(
      canRequest: true,
      serverAt: server,
      endsAt: server.add(const Duration(minutes: 20)),
    );
    expect(access.requestEnabled, isTrue);
    expect(access.minutesLeft, 20);
    final closed = IncidentPhotoAccess(
      canRequest: true,
      serverAt: server,
      endsAt: server,
    );
    expect(closed.requestEnabled, isFalse);
  });
  test(
    'incident request carries only an explicit idempotent intent and is never retried automatically',
    () async {
      var calls = 0;
      final service = SafetySnapshotService(
        baseUrl: 'https://gateway.example',
        token: () async => 'token',
        client: MockClient((req) async {
          calls++;
          expect(req.method, 'POST');
          expect(req.url.path, '/api/incident-photos/incident-one/requests');
          expect(jsonDecode(req.body), {'requestKey': 'intent-one'});
          throw http.ClientException('private');
        }),
      );
      await expectLater(
        service.requestIncidentPhoto('incident-one', 'intent-one'),
        throwsA(isA<SnapshotFailure>()),
      );
      expect(calls, 1);
      service.dispose();
    },
  );
  testWidgets(
    'wearer card is grey before an alert and after closure, and fails closed on connection loss',
    (tester) async {
      final service = WindowService()..open = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: IncidentPhotoAction(imei: 'watch-one', service: service),
          ),
        ),
      );
      await tester.pump();
      expect(
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
        isNull,
      );
      service.open = true;
      await tester.pump(const Duration(seconds: 15));
      await tester.pump();
      expect(find.textContaining('47 min left'), findsOneWidget);
      expect(
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
        isNotNull,
      );
      service.denied = true;
      await tester.pump(const Duration(seconds: 15));
      await tester.pump();
      expect(
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
        isNull,
      );
      await tester.pumpWidget(const SizedBox());
      service.dispose();
    },
  );
  testWidgets(
    'failed first photo still permits an explicit request; taps cannot overlap',
    (tester) async {
      final service = WindowService()..send = Completer<String>();
      await tester.pumpWidget(
        MaterialApp(
          home: IncidentPhotoPage(incidentId: 'incident-one', service: service),
        ),
      );
      await tester.pump();
      final button = find.byKey(const Key('incident-request-photo'));
      await tester.tap(button);
      await tester.pump();
      expect(tester.widget<FilledButton>(button).onPressed, isNull);
      expect(service.keys.length, 1);
      service.pending = true;
      service.send!.complete('request-one');
      await tester.pump();
      await tester.pump();
      expect(find.text('Waiting for photo…'), findsOneWidget);
      expect(tester.widget<FilledButton>(button).onPressed, isNull);
      await tester.pumpWidget(const SizedBox());
      service.dispose();
    },
  );
  testWidgets('ambiguous response keeps the same intent for a status check', (
    tester,
  ) async {
    final service = WindowService()..ambiguous = true;
    await tester.pumpWidget(
      MaterialApp(
        home: IncidentPhotoPage(incidentId: 'incident-one', service: service),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('incident-request-photo')));
    await tester.pump();
    await tester.pump();
    expect(find.text('Check previous request'), findsOneWidget);
    await tester.tap(find.byKey(const Key('incident-request-photo')));
    await tester.pump();
    await tester.pump();
    expect(service.keys.length, 2);
    expect(service.keys[0], service.keys[1]);
    service.open = false;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('incident-request-photo')))
          .onPressed,
      isNull,
    );
    await tester.pumpWidget(const SizedBox());
    service.dispose();
  });
}

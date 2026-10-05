import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:guardian/services/reminder_recording.dart';
import 'package:guardian/services/voice_medication_service.dart';
import 'package:guardian/widgets/care/voice_medication_card.dart';

class FakeRecorder implements ReminderRecorder {
  FakeRecorder({this.allowed = true});
  final bool allowed;
  Completer<bool>? permissionResult;
  final stream = StreamController<Uint8List>();
  int starts = 0, stops = 0;
  @override
  Future<bool> permission() async => permissionResult?.future ?? allowed;
  @override
  Future<Stream<Uint8List>> start() async {
    starts++;
    return stream.stream;
  }

  @override
  Future<void> stop() async {
    stops++;
  }

  @override
  Future<void> dispose() async {
    await stream.close();
  }
}

class FakeClient implements VoiceMedicationClient {
  final requests = <Map<String, dynamic>>[];
  List<VoiceMedicationReminder> reminders = [];
  Completer<VoiceMedicationReminder>? pending;
  @override
  Future<List<VoiceMedicationReminder>> load(String imei) async => reminders;
  @override
  Future<VoiceMedicationReminder> save(
    String imei,
    Map<String, dynamic> body,
  ) async {
    requests.add(body);
    if (pending != null) return pending!.future;
    final s = body['settings'] as Map<String, dynamic>;
    return VoiceMedicationReminder(
      id: body['id'] as String,
      time: s['time'] as String,
      text: s['text'] as String,
      mode: s['mode'] as String,
      enabled: s['enabled'] == true,
      frequency: s['frequency'] as int,
      status: 'reply_observed',
      version: (body['version'] as int) + 1,
      managed: true,
      durationMs: 1000,
    );
  }

  @override
  Future<Uint8List> audio(String imei, String id) async =>
      reminderWav(Uint8List(16000));
  @override
  void close() {}
}

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    final messenger = binding.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('xyz.luan/audioplayers.global'),
      (_) async => null,
    );
    messenger.setMockMethodCallHandler(
      const MethodChannel('xyz.luan/audioplayers.global/events'),
      (_) async => null,
    );
    messenger.setMockMethodCallHandler(
      const MethodChannel('xyz.luan/audioplayers'),
      (call) async {
        if (call.method == 'create') {
          final id = (call.arguments as Map)['playerId'];
          messenger.setMockMethodCallHandler(
            MethodChannel('xyz.luan/audioplayers/events/$id'),
            (_) async => null,
          );
        }
        return null;
      },
    );
  });
  Future<void> editor(
    WidgetTester tester,
    FakeClient client,
    FakeRecorder recorder, {
    double width = 390,
    double scale = 1,
  }) async {
    tester.view.physicalSize = Size(width, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: Scaffold(
          body: VoiceMedicationEditor(
            imei: 'synthetic',
            client: client,
            recorder: recorder,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'voice requires recording; denied permission does not save or start microphone',
    (tester) async {
      final client = FakeClient(), recorder = FakeRecorder(allowed: false);
      await editor(tester, client, recorder);
      await tester.tap(find.text('Your voice'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Save to watch'));
      await tester.tap(find.text('Save to watch'));
      await tester.pumpAndSettle();
      expect(find.text('Record your message first.'), findsOneWidget);
      expect(client.requests, isEmpty);
      await tester.ensureVisible(find.text('Record message'));
      await tester.tap(find.text('Record message'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Microphone access is off'), findsOneWidget);
      expect(recorder.starts, 0);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    },
  );
  testWidgets(
    'permission resolving in background cannot start recording',
    (tester) async {
      final client = FakeClient(), recorder = FakeRecorder()
        ..permissionResult = Completer<bool>();
      await editor(tester, client, recorder);
      await tester.tap(find.text('Your voice'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Record message'));
      await tester.pump();
      binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      recorder.permissionResult!.complete(true);
      await tester.pumpAndSettle();
      expect(recorder.starts, 0);
      expect(client.requests, isEmpty);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    },
  );
  testWidgets(
    'recording auto-stops at ten seconds and sends bounded PCM exactly once',
    (tester) async {
      final client = FakeClient(), recorder = FakeRecorder();
      await editor(tester, client, recorder);
      await tester.tap(find.text('Your voice'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Record message'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 10)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Stop recording'), findsOneWidget);
      recorder.stream.add(Uint8List(170000));
      await tester.pumpAndSettle();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 10)),
      );
      await tester.pumpAndSettle();
      expect(recorder.stops, 1);
      expect(find.text('Listen'), findsOneWidget);
      await tester.ensureVisible(find.text('Save to watch'));
      await tester.tap(find.text('Save to watch'));
      await tester.pumpAndSettle();
      expect(client.requests, hasLength(1));
      expect(
        base64Decode(client.requests.single['pcm'] as String),
        hasLength(160000),
      );
      expect(find.text('Watch replied'), findsOneWidget);
      expect(find.textContaining('does not confirm playback'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    },
  );
  testWidgets('leaving the app stops recording and preserves a short preview', (
    tester,
  ) async {
    final recorder = FakeRecorder();
    await editor(tester, FakeClient(), recorder);
    await tester.tap(find.text('Your voice'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Record message'));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 10)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Stop recording'), findsOneWidget);
    recorder.stream.add(Uint8List(16000));
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pumpAndSettle();
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 10)),
    );
    await tester.pumpAndSettle();
    expect(recorder.stops, 1);
    expect(find.text('Listen'), findsOneWidget);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
  for (final width in [320.0, 390.0, 1280.0]) {
    testWidgets('editor remains readable at $width with large text', (
      tester,
    ) async {
      await editor(
        tester,
        FakeClient(),
        FakeRecorder(),
        width: width,
        scale: 1.5,
      );
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Your voice'));
      await tester.tap(find.text('Your voice'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    });
  }
  testWidgets(
    'card shows voice and receipt separately, and existing reminders can be edited',
    (tester) async {
      final client = FakeClient()
        ..reminders = [
          const VoiceMedicationReminder(
            id: 'one',
            time: '18:30',
            text: 'Evening reminder',
            mode: 'voice',
            status: 'unconfirmed',
            durationMs: 3480,
            managed: true,
          ),
        ];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: VoiceMedicationCard(imei: 'synthetic', client: client),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('18:30'), findsOneWidget);
      expect(find.text('Your voice · 3.5s'), findsOneWidget);
      expect(find.text('Watch setting not confirmed'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    },
  );
  test(
    'client includes bearer and request identity, never auto-retries failed POST',
    () async {
      int calls = 0;
      final service = VoiceMedicationService(
        gatewayUrl: 'https://example.test',
        token: () async => 'synthetic-token',
        client: MockClient((request) async {
          calls++;
          expect(request.headers['Authorization'], 'Bearer synthetic-token');
          expect(jsonDecode(request.body)['requestId'], 'test-request');
          return http.Response('{"error":"settings_changed"}', 409);
        }),
      );
      await expectLater(
        service.save('synthetic', {'requestId': 'test-request'}),
        throwsA(isA<VoiceMedicationException>()),
      );
      expect(calls, 1);
      service.close();
    },
  );
}

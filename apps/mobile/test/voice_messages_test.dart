import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:guardian/services/reminder_recording.dart';
import 'package:guardian/services/voice_messages_service.dart';
import 'package:guardian/screens/voice_messages_page.dart';
import 'package:guardian/widgets/dashboard/voice_message_action.dart';

VoiceMessage clip({
  String id = 'incoming',
  bool incoming = true,
  String status = 'received',
}) => VoiceMessage(
  id: id,
  direction: incoming ? 'incoming' : 'outgoing',
  createdAt: DateTime.now(),
  expiresAt: DateTime.now().add(const Duration(hours: 24)),
  durationMs: 1000,
  status: status,
);

class InboxClient implements VoiceMessagesClient {
  final changes = StreamController<void>.broadcast();
  final sends = <Uint8List>[];
  VoiceInbox inbox = const VoiceInbox(connected: true);
  Object? failure;
  Object? sendFailure;
  Completer<Uint8List>? pendingAudio;
  int plays = 0, audioReads = 0;
  @override
  Stream<void> get accessChanges => changes.stream;
  @override
  Future<VoiceInbox> load(String imei) async {
    if (failure != null) throw failure!;
    return inbox;
  }

  @override
  Future<VoiceMessage> send(
    String imei, {
    required String id,
    required Uint8List pcm,
    required DateTime createdAt,
  }) async {
    sends.add(pcm);
    if (sendFailure != null) throw sendFailure!;
    final sent = clip(id: id, incoming: false, status: 'reply_observed');
    inbox = VoiceInbox(connected: true, messages: [sent]);
    return sent;
  }

  @override
  Future<Uint8List> audio(String imei, String id) async {
    audioReads++;
    return pendingAudio?.future ?? reminderWav(Uint8List(16000));
  }

  @override
  Future<void> played(String imei, String id) async {
    plays++;
  }

  @override
  Future<void> delete(String imei, String id) async {
    inbox = const VoiceInbox(connected: true);
  }

  @override
  void close() {}
}

class Recorder implements ReminderRecorder {
  Completer<bool>? permissionResult;
  final bytes = StreamController<Uint8List>();
  int starts = 0, stops = 0;
  @override
  Future<bool> permission() async => permissionResult?.future ?? true;
  @override
  Future<Stream<Uint8List>> start() async {
    starts++;
    return bytes.stream;
  }

  @override
  Future<void> stop() async {
    stops++;
  }

  @override
  Future<void> dispose() async {
    await bytes.close();
  }
}

class Player implements VoiceClipPlayer {
  Completer<void>? pendingStart;
  final completions = StreamController<void>.broadcast();
  final positions = StreamController<Duration>.broadcast();
  int plays = 0, stops = 0;
  @override
  Stream<void> get completed => completions.stream;
  @override
  Stream<Duration> get position => positions.stream;
  @override
  Future<void> play(Uint8List wav) async {
    expect(String.fromCharCodes(wav.take(4)), 'RIFF');
    plays++;
    await pendingStart?.future;
  }

  @override
  Future<void> stop() async {
    stops++;
  }

  @override
  Future<void> dispose() async {
    await completions.close();
    await positions.close();
  }
}

Future<void> screen(
  WidgetTester t,
  InboxClient client,
  Recorder recorder,
  Player player,
) async {
  await t.pumpWidget(
    MaterialApp(
      home: VoiceMessagesPage(
        imei: '999999999999999',
        wearerName: 'Family member',
        client: client,
        recorder: recorder,
        player: player,
      ),
    ),
  );
  await t.pumpAndSettle();
}

void main() {
  testWidgets(
    'sender avatars distinguish the conversation and playback progress follows the player',
    (t) async {
      final semantics = t.ensureSemantics();
      t.view.physicalSize = const Size(800, 1000);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.resetPhysicalSize);
      addTearDown(t.view.resetDevicePixelRatio);
      final client = InboxClient()
        ..inbox = VoiceInbox(
          connected: true,
          messages: [
            clip(),
            clip(id: 'outgoing', incoming: false, status: 'reply_observed'),
          ],
        );
      final recorder = Recorder(), player = Player();
      await screen(t, client, recorder, player);
      expect(find.bySemanticsLabel('Family member avatar'), findsOneWidget);
      expect(find.bySemanticsLabel('Your avatar'), findsOneWidget);
      final incoming = find.byKey(const ValueKey('voice-bubble-incoming'));
      final outgoing = find.byKey(const ValueKey('voice-bubble-outgoing'));
      expect(t.getTopLeft(incoming).dx, lessThan(t.getTopLeft(outgoing).dx));
      await t.tap(
        find.descendant(of: incoming, matching: find.byTooltip('Play message')),
      );
      await t.pumpAndSettle();
      player.positions.add(const Duration(milliseconds: 500));
      await t.pumpAndSettle();
      expect(
        t
            .widget<LinearProgressIndicator>(
              find.descendant(
                of: incoming,
                matching: find.byType(LinearProgressIndicator),
              ),
            )
            .value,
        .5,
      );
      expect(player.plays, 1);
      await t.pumpWidget(const SizedBox());
      semantics.dispose();
    },
  );
  testWidgets(
    'discard invalidates a preview still starting and never sends the draft',
    (t) async {
      final client = InboxClient(),
          recorder = Recorder(),
          player = Player()..pendingStart = Completer<void>();
      await screen(t, client, recorder, player);
      await t.tap(find.text('Record a message'));
      await t.pumpAndSettle();
      recorder.bytes.add(Uint8List(16000));
      await t.pump();
      await t.tap(find.text('Stop recording'));
      await t.pumpAndSettle();
      await t.tap(find.text('Preview'));
      await t.pump();
      await t.tap(find.text('Discard'));
      await t.pumpAndSettle();
      final stopped = player.stops;
      player.pendingStart!.complete();
      await t.pumpAndSettle();
      expect(player.stops, greaterThan(stopped));
      expect(find.text('Send'), findsNothing);
      expect(client.sends, isEmpty);
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'an uncertain send is never replayed by refresh or recorded again while unresolved',
    (t) async {
      final client = InboxClient()..sendFailure = TimeoutException('synthetic'),
          recorder = Recorder(),
          player = Player();
      await screen(t, client, recorder, player);
      await t.tap(find.text('Record a message'));
      await t.pumpAndSettle();
      recorder.bytes.add(Uint8List(16000));
      await t.pump();
      await t.tap(find.text('Stop recording'));
      await t.pumpAndSettle();
      await t.tap(find.text('Send'));
      await t.pumpAndSettle();
      await t.tap(find.byTooltip('Refresh messages'));
      await t.pumpAndSettle();
      expect(client.sends, hasLength(1));
      expect(
        t
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Record a message'),
            )
            .onPressed,
        isNull,
      );
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'an audio download finishing after background cannot start playback',
    (t) async {
      final client = InboxClient()
            ..inbox = VoiceInbox(connected: true, messages: [clip()])
            ..pendingAudio = Completer<Uint8List>(),
          recorder = Recorder(),
          player = Player();
      await screen(t, client, recorder, player);
      await t.tap(find.byTooltip('Play message'));
      await t.pump();
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await t.pump();
      client.pendingAudio!.complete(reminderWav(Uint8List(16000)));
      await t.pumpAndSettle();
      expect(player.plays, 0);
      expect(client.plays, 0);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await t.pumpAndSettle();
      await t.pumpWidget(const SizedBox());
    },
  );
  test(
    'authenticated service scopes every request and never retries an uncertain send',
    () async {
      final requests = <http.Request>[];
      final client = VoiceMessagesService(
        gatewayUrl: 'https://gateway.test',
        token: () async => 'test-token',
        client: MockClient((request) async {
          requests.add(request);
          return http.Response(
            jsonEncode({'error': 'gateway_unavailable'}),
            503,
          );
        }),
      );
      await expectLater(
        client.send(
          'watch',
          id: 'id',
          pcm: Uint8List(16000),
          createdAt: DateTime.now(),
        ),
        throwsA(isA<VoiceMessageException>()),
      );
      expect(requests, hasLength(1));
      expect(requests.single.url.queryParameters['imei'], 'watch');
      expect(requests.single.headers['Authorization'], 'Bearer test-token');
      expect(
        jsonDecode(requests.single.body)['pcm'],
        base64Encode(Uint8List(16000)),
      );
      for (final url in [
        'http://untrusted.test',
        'https://user:secret@gateway.test',
        'https://gateway.test/path',
      ]) {
        await expectLater(
          VoiceMessagesService(
            gatewayUrl: url,
            token: () async => 'token',
          ).load('watch'),
          throwsA(isA<VoiceMessageException>()),
        );
      }
      client.close();
    },
  );
  testWidgets(
    'recording requires preview and explicit Send; no autoplay or emergency prerequisite',
    (t) async {
      final client = InboxClient(), recorder = Recorder(), player = Player();
      await screen(t, client, recorder, player);
      expect(player.plays, 0);
      expect(client.sends, isEmpty);
      await t.tap(find.text('Record a message'));
      await t.pumpAndSettle();
      recorder.bytes.add(Uint8List(16000));
      await t.pump();
      await t.tap(find.text('Stop recording'));
      await t.pumpAndSettle();
      expect(find.text('Ready to send · 1.0 sec'), findsOneWidget);
      expect(client.sends, isEmpty);
      await t.tap(find.text('Preview'));
      await t.pumpAndSettle();
      expect(player.plays, 1);
      await t.tap(find.text('Send'));
      await t.pumpAndSettle();
      expect(client.sends, hasLength(1));
      expect(find.text('Watch replied'), findsOneWidget);
      expect(find.text('Send'), findsNothing);
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'incoming clips play only on tap and mark local playback, with explicit deletion',
    (t) async {
      final client = InboxClient()
            ..inbox = VoiceInbox(connected: true, messages: [clip()]),
          recorder = Recorder(),
          player = Player();
      await screen(t, client, recorder, player);
      expect(client.audioReads, 0);
      expect(player.plays, 0);
      expect(find.text('New message'), findsOneWidget);
      await t.tap(find.byTooltip('Play message'));
      await t.pumpAndSettle();
      expect(client.audioReads, 1);
      expect(client.plays, 1);
      expect(player.plays, 1);
      await t.tap(find.byTooltip('Message options'));
      await t.pumpAndSettle();
      await t.tap(find.text('Delete message'));
      await t.pumpAndSettle();
      expect(find.text('Delete voice message?'), findsOneWidget);
      await t.tap(find.text('Delete'));
      await t.pumpAndSettle();
      expect(find.text('New message'), findsNothing);
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'background during permission prompt never starts the microphone',
    (t) async {
      final client = InboxClient(),
          recorder = Recorder()..permissionResult = Completer<bool>(),
          player = Player();
      await screen(t, client, recorder, player);
      await t.tap(find.text('Record a message'));
      await t.pump();
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await t.pump();
      recorder.permissionResult!.complete(true);
      await t.pumpAndSettle();
      expect(recorder.starts, 0);
      expect(client.sends, isEmpty);
      t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await t.pumpAndSettle();
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets('background stops recording and discards the private draft', (
    t,
  ) async {
    final client = InboxClient(), recorder = Recorder(), player = Player();
    await screen(t, client, recorder, player);
    await t.tap(find.text('Record a message'));
    await t.pumpAndSettle();
    recorder.bytes.add(Uint8List(16000));
    await t.pump();
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await t.pumpAndSettle();
    expect(recorder.stops, 1);
    expect(find.text('Send'), findsNothing);
    expect(client.sends, isEmpty);
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await t.pumpAndSettle();
    await t.pumpWidget(const SizedBox());
  });
  testWidgets('recording stops at the bounded limit without sending', (
    t,
  ) async {
    final client = InboxClient(), recorder = Recorder(), player = Player();
    await screen(t, client, recorder, player);
    await t.tap(find.text('Record a message'));
    await t.pumpAndSettle();
    recorder.bytes.add(Uint8List(500000));
    await t.pumpAndSettle();
    expect(find.text('Ready to send · 30.0 sec'), findsOneWidget);
    expect(recorder.stops, 1);
    expect(client.sends, isEmpty);
    await t.pumpWidget(const SizedBox());
  });
  testWidgets(
    'revoked access clears history and playback; offline and pending sends cannot record',
    (t) async {
      final client = InboxClient()
            ..inbox = VoiceInbox(connected: true, messages: [clip()]),
          recorder = Recorder(),
          player = Player();
      await screen(t, client, recorder, player);
      client.failure = const VoiceMessageException('device_not_linked');
      client.changes.add(null);
      await t.pumpAndSettle();
      expect(find.text('New message'), findsNothing);
      expect(
        t
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Record a message'),
            )
            .onPressed,
        isNull,
      );
      client.failure = null;
      client.inbox = const VoiceInbox(connected: false);
      await t.tap(find.byTooltip('Refresh messages'));
      await t.pumpAndSettle();
      expect(find.text('Watch offline'), findsOneWidget);
      expect(
        t
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Record a message'),
            )
            .onPressed,
        isNull,
      );
      client.inbox = const VoiceInbox(connected: true, sendingBlocked: true);
      await t.tap(find.byTooltip('Refresh messages'));
      await t.pumpAndSettle();
      expect(
        t
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Record a message'),
            )
            .onPressed,
        isNull,
      );
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'wearer action shows unread badge and hides on access revocation',
    (t) async {
      final client = InboxClient()
        ..inbox = VoiceInbox(connected: true, messages: [clip()]);
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: VoiceMessageAction(
              imei: 'watch',
              wearerName: 'Family member',
              client: client,
            ),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Voice messages · 1 new'), findsOneWidget);
      client.failure = const VoiceMessageException('feature_unavailable');
      client.changes.add(null);
      await t.pumpAndSettle();
      expect(find.byType(OutlinedButton), findsNothing);
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets('conversation and composer fit a small phone with larger text', (
    t,
  ) async {
    t.view.physicalSize = const Size(320, 720);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    final client = InboxClient()
          ..inbox = VoiceInbox(connected: true, messages: [clip()]),
        recorder = Recorder(),
        player = Player();
    await t.pumpWidget(
      MaterialApp(
        builder: (_, child) => MediaQuery(
          data: const MediaQueryData(
            size: Size(320, 720),
            textScaler: TextScaler.linear(1.5),
          ),
          child: child!,
        ),
        home: VoiceMessagesPage(
          imei: 'watch',
          wearerName: 'Family member',
          client: client,
          recorder: recorder,
          player: player,
        ),
      ),
    );
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);
    await t.pumpWidget(const SizedBox());
  });
}

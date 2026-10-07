import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:guardian/services/intelligence_service.dart';
import 'package:guardian/widgets/intelligence_view.dart';

IntelligenceAnswer answer({
  String text = 'Watch connected. Last check-in: 14:10.',
  String mode = 'recorded',
  int seconds = 60,
}) => IntelligenceAnswer(
  asOf: DateTime.now(),
  validUntil: DateTime.now().add(Duration(seconds: seconds)),
  mode: mode,
  facts: [
    IntelligenceFact(id: text, text: text, source: 'watch', screen: 'watch'),
  ],
  gaps: ['A check-in does not confirm the wearer’s condition.'],
  suggestions: ['Any recent alerts?'],
);

class Client implements IntelligenceClient {
  final changes = StreamController<void>.broadcast();
  int reads = 0;
  Completer<IntelligenceAnswer>? pending;
  Object? failure;
  IntelligenceAnswer value = answer();
  @override
  Stream<void> accessChanges(String imei) => changes.stream;
  @override
  Future<IntelligenceAnswer> load(String imei, {String? incidentId}) async {
    reads++;
    if (failure != null) throw failure!;
    return pending?.future ?? value;
  }

  @override
  void close() {
    changes.close();
  }
}

Widget view(
  Client client, {
  String imei = 'watch-one',
  double scale = 1,
  Key? previewKey,
}) => MaterialApp(
  theme: buildGuardianTheme(),
  home: MediaQuery(
    data: MediaQueryData(textScaler: TextScaler.linear(scale)),
    child: Scaffold(
      backgroundColor: const Color(0xffedf3ef),
      appBar: AppBar(title: const Text('Guardian')),
      body: SingleChildScrollView(
        child: RepaintBoundary(
          key: previewKey,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: IntelligenceView(
              imei: imei,
              wearerName: 'Your loved one',
              client: client,
              onEvidence: (_) {},
            ),
          ),
        ),
      ),
    ),
  ),
);

void main() {
  setUpAll(() async {
    GoogleFonts.config.allowRuntimeFetching = false;
    final font = Platform.environment['INTELLIGENCE_PREVIEW_FONT'];
    if (font != null) {
      // Optional local preview uses a caller-supplied fallback font; the
      // production theme and controls remain unchanged. No font is committed.
      final bytes = ByteData.sublistView(await File(font).readAsBytes());
      final assets = <String, Object>{};
      for (final family in ['Inter', 'Manrope']) {
        for (final weight in [
          'Thin',
          'ExtraLight',
          'Light',
          'Regular',
          'Medium',
          'SemiBold',
          'Bold',
          'ExtraBold',
          'Black',
        ]) {
          final name = 'preview/$family-$weight.ttf';
          assets[name] = [
            {'asset': name},
          ];
        }
      }
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMessageHandler('flutter/assets', (message) async {
            final name = utf8.decode(message!.buffer.asUint8List());
            if (name == 'AssetManifest.bin') {
              return const StandardMessageCodec().encodeMessage(assets);
            }
            if (name.startsWith('preview/')) return bytes;
            return null;
          });
      for (final family in ['Ahem', 'Inter', 'Manrope']) {
        final loader = FontLoader(family)
          ..addFont(
            File(
              font,
            ).readAsBytes().then((bytes) => ByteData.sublistView(bytes)),
          );
        await loader.load();
      }
      final icons = Platform.environment['INTELLIGENCE_PREVIEW_ICONS'];
      if (icons != null) {
        await (FontLoader('MaterialIcons')..addFont(
              File(
                icons,
              ).readAsBytes().then((bytes) => ByteData.sublistView(bytes)),
            ))
            .load();
      }
    }
  });
  test('service exposes authenticated recorded reads only', () async {
    final requests = <http.Request>[];
    final now = DateTime.now().millisecondsSinceEpoch;
    final service = IntelligenceService(
      gatewayUrl: 'https://guardian.example',
      token: () async => 'test-token',
      client: MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({
            'asOf': now,
            'validUntil': now + 60000,
            'mode': 'recorded',
            'facts': [],
            'gaps': [],
            'suggestions': [],
          }),
          200,
        );
      }),
    );
    await service.load('watch-one', incidentId: 'event-one');
    expect(requests.map((r) => r.method), ['GET']);
    expect(requests.first.url.queryParameters['incidentId'], 'event-one');
    expect(requests.last.headers['Authorization'], 'Bearer test-token');
    expect(requests.last.body, isEmpty);
    service.close();
  });

  test(
    'service rejects untrusted transport and never retries an interrupted read',
    () async {
      int calls = 0;
      for (final url in [
        'http://remote.example',
        'https://user:secret@example.test',
        'https://example.test/?token=x',
      ]) {
        final service = IntelligenceService(
          gatewayUrl: url,
          token: () async => 'token',
          client: MockClient((_) async {
            calls++;
            return http.Response('{}', 500);
          }),
        );
        await expectLater(
          service.load('watch'),
          throwsA(isA<IntelligenceException>()),
        );
        service.close();
      }
      expect(calls, 0);
      final service = IntelligenceService(
        gatewayUrl: 'https://example.test',
        token: () async => 'token',
        client: MockClient((_) async {
          calls++;
          throw http.ClientException('connection interrupted');
        }),
      );
      await expectLater(
        service.load('watch'),
        throwsA(isA<http.ClientException>()),
      );
      expect(calls, 1);
      service.close();
    },
  );

  testWidgets(
    'narrow and large-text layouts show source limits without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1050);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final client = Client(), key = GlobalKey();
      await tester.pumpWidget(view(client, previewKey: key));
      await tester.pumpAndSettle();
      expect(find.text('Today with Guardian'), findsOneWidget);
      expect(find.text('From recorded information'), findsOneWidget);
      expect(find.text('Ask Guardian'), findsNothing);
      final preview = Platform.environment['INTELLIGENCE_PREVIEW'];
      if (preview != null) {
        final boundary =
            key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        final image = (await tester.runAsync(
          () => boundary.toImage(pixelRatio: 2),
        ))!;
        final data = await tester.runAsync(
          () => image.toByteData(format: ui.ImageByteFormat.png),
        );
        await tester.runAsync(
          () => File(preview).writeAsBytes(data!.buffer.asUint8List()),
        );
        image.dispose();
      }
      await tester.pumpWidget(view(client, scale: 1.8));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      client.close();
    },
  );

  testWidgets('overview has no composer and refresh only rereads records', (
    tester,
  ) async {
    final client = Client();
    await tester.pumpWidget(view(client));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsNothing);
    expect(find.text('Ask Guardian'), findsNothing);
    await tester.tap(find.byTooltip('Refresh recorded overview'));
    await tester.pumpAndSettle();
    expect(client.reads, 2);
    await tester.pumpWidget(const SizedBox());
    client.close();
  });

  testWidgets('revoked access discards old answer and in-flight results', (
    tester,
  ) async {
    final client = Client();
    await tester.pumpWidget(view(client));
    await tester.pumpAndSettle();
    final pending = Completer<IntelligenceAnswer>();
    client.pending = pending;
    await tester.tap(find.byTooltip('Refresh recorded overview'));
    await tester.pump();
    client.failure = const IntelligenceException('access_changed');
    client.changes.add(null);
    await tester.pump();
    await tester.pump();
    pending.complete(answer(text: 'Private old answer'));
    await tester.pumpAndSettle();
    expect(find.text('Private old answer'), findsNothing);
    expect(
      find.text('This overview is not available with your current access.'),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox());
    client.close();
  });

  testWidgets(
    'changing wearer or backgrounding clears private evidence immediately',
    (tester) async {
      final client = Client();
      await tester.pumpWidget(view(client));
      await tester.pumpAndSettle();
      final pending = Completer<IntelligenceAnswer>();
      client.pending = pending;
      await tester.pumpWidget(view(client, imei: 'watch-two'));
      await tester.pump();
      expect(find.text('Watch connected. Last check-in: 14:10.'), findsNothing);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      pending.complete(answer(text: 'Other wearer'));
      await tester.pumpAndSettle();
      expect(find.text('Other wearer'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      client.close();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    },
  );
}

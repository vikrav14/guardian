// Explicit visual review, synthetic messages only. No Firebase or microphone.
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/widgets/voice_conversation_view.dart';
import 'package:guardian/services/voice_messages_service.dart';
import 'package:guardian/theme/app_theme.dart';

void main() {
  for (final width in [390.0, 1000.0]) {
    testWidgets('render voice conversation $width', (tester) async {
      tester.view.physicalSize = Size(width, 850);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.runAsync(() async {
        final fontFile = Platform.isWindows
            ? 'C:/Windows/Fonts/segoeui.ttf'
            : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
        await (FontLoader('VoicePreview')..addFont(
              Future.value(
                ByteData.sublistView(await File(fontFile).readAsBytes()),
              ),
            ))
            .load();
        await (FontLoader(
          'MaterialIcons',
        )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
      });
      final now = DateTime.now(), key = GlobalKey();
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            useMaterial3: true,
            fontFamily: 'VoicePreview',
            colorScheme: ColorScheme.fromSeed(
              seedColor: GuardianThemeColors.light.accent,
              surface: GuardianThemeColors.light.surface,
            ),
          ),
          home: RepaintBoundary(
            key: key,
            child: VoiceConversationView(
              name: 'Maya',
              inbox: VoiceInbox(
                connected: true,
                messages: [
                  VoiceMessage(
                    id: 'outgoing',
                    direction: 'outgoing',
                    createdAt: now.subtract(const Duration(minutes: 2)),
                    expiresAt: now.add(const Duration(hours: 24)),
                    durationMs: 4000,
                    status: 'reply_observed',
                  ),
                  VoiceMessage(
                    id: 'incoming',
                    direction: 'incoming',
                    createdAt: now,
                    expiresAt: now.add(const Duration(hours: 24)),
                    durationMs: 6000,
                    status: 'received',
                  ),
                ],
              ),
              error: null,
              playing: 'incoming',
              position: const Duration(seconds: 2),
              recording: false,
              starting: false,
              sending: false,
              pending: false,
              canRecord: true,
              recordedBytes: 0,
              draftBytes: null,
              refresh: () {},
              record: () {},
              stop: () {},
              preview: () {},
              discard: () {},
              send: () {},
              play: (_) {},
              remove: (_) {},
              onClose: () {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.runAsync(() async {
        final boundary =
            key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final out = Directory('build/voice-review')
          ..createSync(recursive: true);
        await File(
          '${out.path}/voice-${width.toInt()}.png',
        ).writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
      await tester.pumpWidget(const SizedBox());
    });
  }
}

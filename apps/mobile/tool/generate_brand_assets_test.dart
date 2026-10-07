// Rebuild native assets from the actual in-app logo, never from a screenshot:
// flutter test --no-pub --dart-define=GENERATE_BRAND_ASSETS=true tool/generate_brand_assets_test.dart
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/widgets/brand/guardian_loading_screen.dart';
import 'package:guardian/widgets/brand/guardian_pin_logo.dart';

void main() {
  testWidgets(
    'export Guardian launcher and launch-screen assets',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1200, 400);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);

      Future<void> export(
        String path, {
        required double canvasSize,
        required double markSize,
        required double pixelRatio,
        double fillProgress = 1,
        bool whiteBackground = true,
      }) async {
        final key = GlobalKey();
        await tester.pumpWidget(
          Directionality(
            textDirection: TextDirection.ltr,
            child: Center(
              child: RepaintBoundary(
                key: key,
                child: SizedBox.square(
                  dimension: canvasSize,
                  child: ColoredBox(
                    color: whiteBackground ? Colors.white : Colors.transparent,
                    child: Center(
                      child: GuardianPinMark(
                        size: markSize,
                        fillProgress: fillProgress,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        final boundary =
            key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await boundary.toImage(pixelRatio: pixelRatio);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          image.dispose();
          final file = File(path);
          await file.parent.create(recursive: true);
          await file.writeAsBytes(bytes!.buffer.asUint8List());
        });
      }

      const res = 'android/app/src/main/res';
      for (final density in {
        'mdpi': 1.0,
        'hdpi': 1.5,
        'xhdpi': 2.0,
        'xxhdpi': 3.0,
        'xxxhdpi': 4.0,
      }.entries) {
        await export(
          '$res/mipmap-${density.key}/ic_launcher.png',
          canvasSize: 48,
          markSize: 36,
          pixelRatio: density.value,
        );
        // Keep the whole mark inside Android's 66 dp adaptive-icon safe circle.
        await export(
          '$res/mipmap-${density.key}/ic_launcher_foreground.png',
          canvasSize: 108,
          markSize: 64,
          pixelRatio: density.value,
          whiteBackground: false,
        );
        // Android 12: 288 dp artwork, with the mark inside the 192 dp circle.
        await export(
          '$res/drawable-${density.key}/guardian_splash.png',
          canvasSize: 288,
          markSize: 192,
          pixelRatio: density.value,
          fillProgress: 0,
          whiteBackground: false,
        );
      }
      await export(
        'build/brand-preview/guardian-app-icon.png',
        canvasSize: 256,
        markSize: 192,
        pixelRatio: 2,
      );
      for (var stage = 0; stage <= 4; stage++) {
        await export(
          'build/brand-preview/guardian-stage-$stage.png',
          canvasSize: 240,
          markSize: 192,
          pixelRatio: 2,
          fillProgress: stage / 4,
        );
      }
      // Capture the real loading widget so reviewers can inspect a full cycle.
      tester.view.physicalSize = const Size(320, 560);
      final animationKey = GlobalKey();
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          home: RepaintBoundary(
            key: animationKey,
            child: const GuardianLoadingScreen(),
          ),
        ),
      );
      final frameCount =
          GuardianLoadingScreen.cycleDuration.inMilliseconds ~/ 50;
      for (var frame = 0; frame < frameCount; frame++) {
        final boundary =
            animationKey.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await boundary.toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          image.dispose();
          await File(
            'build/brand-preview/frame-${frame.toString().padLeft(3, '0')}.png',
          ).writeAsBytes(bytes!.buffer.asUint8List());
        });
        await tester.pump(const Duration(milliseconds: 50));
      }
      await tester.pumpWidget(const SizedBox());
    },
    skip: !const bool.fromEnvironment('GENERATE_BRAND_ASSETS'),
  );
}

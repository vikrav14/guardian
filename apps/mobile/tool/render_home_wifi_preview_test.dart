// Synthetic render: no Firebase, real router data, map tiles or watch commands.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/screens/home_wifi_setup_page.dart';
import 'package:guardian/theme/colors.dart';

import '../test/home_wifi_setup_test.dart' show FakeWifiClient, zone;
import 'render_wellness_previews_test.dart' show loadPreviewFonts;

void main() {
  for (final width in [390.0, 1280.0]) {
    testWidgets('render Home Wi-Fi ${width.toInt()}', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(width, 1200);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await loadPreviewFonts(tester);
      final key = GlobalKey();
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            useMaterial3: true,
            fontFamily: 'WellnessPreview',
            extensions: [GuardianThemeColors.light],
            colorScheme: ColorScheme.fromSeed(
              seedColor: GuardianThemeColors.light.accent,
            ),
          ),
          home: RepaintBoundary(
            key: key,
            child: HomeWifiSetupPage(
              zone: zone,
              client: FakeWifiClient(),
              mapBuilder: (_) => const ColoredBox(
                color: Color(0xFFE2EDE7),
                child: Center(child: Text('Home pin · synthetic map')),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final boundary =
          key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        image.dispose();
        final directory = Directory('build/home-wifi-previews');
        await directory.create(recursive: true);
        await File('${directory.path}/home_wifi_${width.toInt()}.png')
            .writeAsBytes(data!.buffer.asUint8List());
      });
      await tester.pumpWidget(const SizedBox());
    }, skip: !const bool.fromEnvironment('HOME_WIFI_PREVIEWS'));
  }
}

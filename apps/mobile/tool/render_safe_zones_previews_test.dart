// Run explicitly: flutter test --dart-define=SAFE_ZONES_PREVIEWS=true
//   tool/render_safe_zones_previews_test.dart --reporter expanded
// Renders the real overview with synthetic records and a labelled map fixture.
// It does not connect to Firebase or request real Google Maps tiles.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test/support/dashboard_fixture.dart';
import '../test/support/safe_zones_fixture.dart';

const _enabled = bool.fromEnvironment('SAFE_ZONES_PREVIEWS');

void main() {
  for (final preview in [
    (name: 'mobile', width: 390.0, height: 1800.0, dark: false),
    (name: 'wide', width: 1280.0, height: 1800.0, dark: false),
    (name: 'mobile_dark', width: 390.0, height: 1800.0, dark: true),
  ]) {
    testWidgets('render ${preview.name} safe zones preview', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(preview.width, preview.height);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.runAsync(() async {
        final fontPath =
            Platform.environment['SAFE_ZONES_PREVIEW_FONT'] ??
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
        final font = FontLoader('SafeZonesPreview');
        font.addFont(
          Future.value(ByteData.sublistView(await File(fontPath).readAsBytes())),
        );
        await font.load();
        final icons = FontLoader('MaterialIcons');
        icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
        await icons.load();
      });

      final boundaryKey = GlobalKey();
      await tester.pumpWidget(
        dashboardFixtureHost(
          safeZonesFixtureOverview(
            zones: [
              safeZoneFixture(),
              safeZoneFixture(
                id: 'preview-zone-school',
                imei: 'demo-watch-b',
                name: 'School',
                radius: 200,
                active: false,
              ),
            ],
            devices: [
              dashboardFixtureDevice(),
              dashboardFixtureDevice(imei: 'demo-watch-b', name: 'Robin Taylor'),
            ],
            alerts: [safeZoneAlertFixture()],
          ),
          dark: preview.dark,
          fontFamily: 'SafeZonesPreview',
          boundaryKey: boundaryKey,
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      final boundary =
          boundaryKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        image.dispose();
        if (data == null) throw StateError('Safe zones PNG encoding failed');
        final bytes = data.buffer.asUint8List(
          data.offsetInBytes,
          data.lengthInBytes,
        );
        final directory = Directory('build/safe-zones-previews');
        await directory.create(recursive: true);
        await File('${directory.path}/${preview.name}.png').writeAsBytes(bytes);
        // Explicit review output, recoverable from authenticated CI job logs.
        // ignore: avoid_print
        print('SAFE_ZONES_PREVIEW_${preview.name}=${base64Encode(bytes)}');
      });
    }, skip: !_enabled);
  }
}

// Run explicitly: flutter test --dart-define=DASHBOARD_PREVIEWS=true
//   tool/render_dashboard_previews_test.dart --reporter expanded
// This renders the real overview widgets with synthetic data and a labeled
// placeholder map. It is intentionally outside the normal test directory.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test/support/dashboard_fixture.dart';

const _enabled = bool.fromEnvironment('DASHBOARD_PREVIEWS');

void main() {
  for (final preview in [
    (name: 'mobile', width: 390.0, height: 1800.0, dark: false, viewport: false),
    (name: 'wide', width: 1280.0, height: 1800.0, dark: false, viewport: false),
    (name: 'mobile_dark', width: 390.0, height: 1800.0, dark: true, viewport: false),
    (name: 'mobile_viewport', width: 390.0, height: 844.0, dark: false, viewport: true),
  ]) {
    testWidgets('render ${preview.name} dashboard preview', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(preview.width, preview.height);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.runAsync(() async {
        final fontPath =
            Platform.environment['DASHBOARD_PREVIEW_FONT'] ??
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
        final font = FontLoader('DashboardPreview');
        font.addFont(
          Future.value(
            ByteData.sublistView(await File(fontPath).readAsBytes()),
          ),
        );
        await font.load();
        final icons = FontLoader('MaterialIcons');
        icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
        await icons.load();
      });

      final boundaryKey = GlobalKey();
      final device = dashboardFixtureDevice();
      await tester.pumpWidget(
        dashboardFixtureHost(
          dashboardFixtureOverview(
            device: device,
            devices: preview.viewport ? [device] : [
              device,
              dashboardFixtureDevice(
                imei: 'demo-watch-b',
                name: 'Robin Taylor',
              ),
            ],
            onCall: () {},
            onJourney: () {},
            onHelp: () {},
            onWatchStatus: () {},
            onLocationDetails: () {},
            onSafeZones: () {},
          ),
          dark: preview.dark,
          fontFamily: 'DashboardPreview',
          boundaryKey: boundaryKey,
          viewport: preview.viewport,
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
        if (data == null) throw StateError('Dashboard PNG encoding failed');
        final bytes = data.buffer.asUint8List(
          data.offsetInBytes,
          data.lengthInBytes,
        );
        final directory = Directory('build/dashboard-previews');
        await directory.create(recursive: true);
        await File('${directory.path}/${preview.name}.png').writeAsBytes(bytes);
        // Ignore the application lint: this explicit tool output lets the
        // reviewer recover the PNG from an authenticated CI job log.
        // ignore: avoid_print
        print('DASHBOARD_PREVIEW_${preview.name}=${base64Encode(bytes)}');
      });
    }, skip: !_enabled);
  }
}

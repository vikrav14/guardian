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
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';
import 'package:guardian/widgets/dashboard/dashboard_reading_status.dart';

import '../test/support/dashboard_fixture.dart';

const _enabled = bool.fromEnvironment('DASHBOARD_PREVIEWS');

void main() {
  for (final preview in [
    (
      name: 'reading_fit',
      width: 390.0,
      height: 1800.0,
      dark: false,
      viewport: false,
    ),
    (
      name: 'reading_waiting',
      width: 390.0,
      height: 1800.0,
      dark: false,
      viewport: false,
    ),
    (
      name: 'reading_received',
      width: 390.0,
      height: 1800.0,
      dark: false,
      viewport: false,
    ),
    (
      name: 'remembered_mobile',
      width: 390.0,
      height: 1800.0,
      dark: false,
      viewport: false,
    ),
    (
      name: 'remembered_wide',
      width: 1280.0,
      height: 1800.0,
      dark: false,
      viewport: false,
    ),
    (
      name: 'remembered_dark',
      width: 390.0,
      height: 1800.0,
      dark: true,
      viewport: false,
    ),
    (
      name: 'mobile',
      width: 390.0,
      height: 1800.0,
      dark: false,
      viewport: false,
    ),
    (name: 'wide', width: 1280.0, height: 1800.0, dark: false, viewport: false),
    (
      name: 'mobile_dark',
      width: 390.0,
      height: 1800.0,
      dark: true,
      viewport: false,
    ),
    (
      name: 'mobile_viewport',
      width: 390.0,
      height: 844.0,
      dark: false,
      viewport: true,
    ),
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
      final now = DateTime.now();
      final observedAt = now.subtract(const Duration(minutes: 1));
      final device = dashboardFixtureDevice(
        rememberedHome: preview.name.startsWith('remembered_'),
      );
      await tester.pumpWidget(
        dashboardFixtureHost(
          dashboardFixtureOverview(
            device: device,
            watchCheckStatus: ReadingStatusTile(
              presentation: ReadingPresentation.at(
                now: now,
                status: {
                  'updatedAt': now,
                  'phase': 'scheduled',
                  if (preview.name != 'reading_waiting')
                    'lastAttempt': {
                      'terminal': true,
                      'outcome': preview.name == 'reading_fit'
                          ? 'temperature_skipped'
                          : 'temperature_upload_observed',
                      'reason': preview.name == 'reading_fit'
                          ? 'unusable_heart_bp'
                          : null,
                      'finishedAt': observedAt,
                    },
                },
              ),
              onTap: () {},
            ),
            devices: preview.viewport
                ? [device]
                : [
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
  for (final sample in [
    (name: 'navigation_light', dark: false, contrast: false, scale: 1.0),
    (name: 'navigation_dark', dark: true, contrast: false, scale: 1.0),
    (name: 'navigation_contrast', dark: false, contrast: true, scale: 2.0),
  ]) {
    testWidgets('render ${sample.name}', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 520);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.runAsync(() async {
        final font = FontLoader('NavigationPreview')
          ..addFont(
            Future.value(
              ByteData.sublistView(
                await File(
                  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                ).readAsBytes(),
              ),
            ),
          );
        await font.load();
      });
      final colors = sample.contrast
          ? GuardianThemeColors.elderCare
          : sample.dark
          ? GuardianThemeColors.dark
          : GuardianThemeColors.light;
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          theme: ThemeData(
            fontFamily: 'NavigationPreview',
            brightness: sample.dark ? Brightness.dark : Brightness.light,
            extensions: [colors],
          ),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: TextScaler.linear(sample.scale),
              highContrast: sample.contrast,
            ),
            child: child!,
          ),
          home: Scaffold(
            backgroundColor: colors.canvas,
            body: Center(
              child: RepaintBoundary(
                key: boundaryKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final selected in [0, 1, 3]) ...[
                      MobileBottomBar(
                        currentIndex: selected,
                        onTap: (_) {},
                        onSos: () {},
                      ),
                      const SizedBox(height: 12),
                    ],
                  ],
                ),
              ),
            ),
          ),
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
        if (data == null) throw StateError('Navigation PNG encoding failed');
        final directory = Directory('build/dashboard-previews');
        await directory.create(recursive: true);
        await File('${directory.path}/${sample.name}.png').writeAsBytes(
          data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
        );
      });
    }, skip: !_enabled);
  }
}

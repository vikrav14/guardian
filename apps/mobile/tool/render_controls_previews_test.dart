// Explicit visual QA of production widgets; no account, watch or live messages.
// flutter test --dart-define=CONTROLS_PREVIEWS=true tool/render_controls_previews_test.dart
import 'dart:io';
import 'dart:convert';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
// The package exposes its manifest specifically for offline font tests.
// ignore: implementation_imports
import 'package:google_fonts/src/google_fonts_base.dart' as font_test;
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/screens/home_wifi_setup_page.dart';
import 'package:guardian/screens/watch_preferences_page.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';
import '../test/home_wifi_setup_test.dart'
    show FakeWifiClient, FakePhoneScanner, zone;
import '../test/watch_preferences_test.dart' show subscriptionFor;

void main() {
  for (final themeId in [
    GuardianThemeId.islandGlass,
    GuardianThemeId.leMorne,
    GuardianThemeId.elderCare,
  ]) {
    for (final width in [390.0, 1280.0]) {
      for (final page in ['preferences', 'wifi']) {
        testWidgets(
          'render $page ${themeId.name} $width',
          (tester) async {
            tester.view.devicePixelRatio = 1;
            tester.view.physicalSize = Size(width, 1050);
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            GoogleFonts.config.allowRuntimeFetching = false;
            await tester.runAsync(() async {
              final font = FontLoader('ControlsReview');
              font.addFont(
                Future.value(
                  ByteData.sublistView(
                    await File(
                      Platform.environment['CONTROLS_PREVIEW_FONT'] ??
                          'C:/Windows/Fonts/segoeui.ttf',
                    ).readAsBytes(),
                  ),
                ),
              );
              await font.load();
              final icons = FontLoader('MaterialIcons');
              icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
              await icons.load();
            });
            final fontBytes = await tester.runAsync(
              () async => ByteData.sublistView(
                await File(
                  Platform.environment['CONTROLS_PREVIEW_FONT'] ??
                      'C:/Windows/Fonts/segoeui.ttf',
                ).readAsBytes(),
              ),
            );
            // Explicit test outside test/ to avoid running renders in CI.
            // ignore: invalid_use_of_visible_for_testing_member
            font_test.assetManifest = _ReviewFontManifest();
            tester.binding.defaultBinaryMessenger.setMockMessageHandler(
              'flutter/assets',
              (message) async {
                final path = utf8.decode(message!.buffer.asUint8List());
                if (path.startsWith('review-fonts/')) return fontBytes;
                final file = File('build/unit_test_assets/$path');
                return file.existsSync()
                    ? ByteData.sublistView(file.readAsBytesSync())
                    : null;
              },
            );
            addTearDown(
              () => tester.binding.defaultBinaryMessenger.setMockMessageHandler(
                'flutter/assets',
                null,
              ),
            );
            final base = buildGuardianTheme(themeId: themeId);
            final label = const WidgetStatePropertyAll(
              TextStyle(
                fontFamily: 'ControlsReview',
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            );
            final theme = base.copyWith(
              textTheme: base.textTheme.apply(fontFamily: 'ControlsReview'),
              filledButtonTheme: FilledButtonThemeData(
                style: base.filledButtonTheme.style!.copyWith(textStyle: label),
              ),
              outlinedButtonTheme: OutlinedButtonThemeData(
                style: base.outlinedButtonTheme.style!.copyWith(
                  textStyle: label,
                ),
              ),
              textButtonTheme: TextButtonThemeData(
                style: base.textButtonTheme.style!.copyWith(textStyle: label),
              ),
            );
            final key = GlobalKey();
            await tester.pumpWidget(
              MaterialApp(
                debugShowCheckedModeBanner: false,
                theme: theme,
                localizationsDelegates: AppLocalizations.localizationsDelegates,
                supportedLocales: AppLocalizations.supportedLocales,
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context).copyWith(
                    textScaler: TextScaler.linear(
                      themeId.isHighContrast ? 1.5 : 1,
                    ),
                  ),
                  child: child!,
                ),
                home: RepaintBoundary(
                  key: key,
                  child: Scaffold(
                    bottomNavigationBar: MobileBottomBar(
                      currentIndex: page == 'wifi' ? 1 : 3,
                      onTap: (_) {},
                    ),
                    body: page == 'wifi'
                        ? HomeWifiSetupPage(
                            zone: zone,
                            client: FakeWifiClient(),
                            scanner: FakePhoneScanner(supported: false),
                            mapBuilder: (_) => const ColoredBox(
                              color: Color(0xFFE2EDE7),
                              child: Center(
                                child: Text(
                                  'Sample Home pin · Mauritius',
                                  style: TextStyle(color: Color(0xFF173C32)),
                                ),
                              ),
                            ),
                          )
                        : WatchPreferencesPage(
                            device: const Device(
                              imei: 'synthetic',
                              nickname: 'Amira',
                              online: false,
                            ),
                            subscription: subscriptionFor('family'),
                          ),
                  ),
                ),
              ),
            );
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
            await tester.runAsync(() async {
              final boundary =
                  key.currentContext!.findRenderObject()!
                      as RenderRepaintBoundary;
              final image = await boundary.toImage(pixelRatio: 1);
              final data = await image.toByteData(
                format: ui.ImageByteFormat.png,
              );
              image.dispose();
              final directory = Directory('build/controls-previews');
              await directory.create(recursive: true);
              await File(
                '${directory.path}/${page}_${themeId.name}_${width.toInt()}.png',
              ).writeAsBytes(data!.buffer.asUint8List());
            });
            await tester.pumpWidget(const SizedBox());
          },
          skip: !const bool.fromEnvironment('CONTROLS_PREVIEWS'),
        );
      }
    }
  }
}

// Substitute a local review font only in this offline render, never in the app.
class _ReviewFontManifest implements AssetManifest {
  @override
  List<String> listAssets() => [
    for (final family in ['Inter', 'Manrope'])
      for (final weight in [
        'Regular',
        'Medium',
        'SemiBold',
        'Bold',
        'ExtraBold',
      ])
        'review-fonts/$family-$weight.ttf',
  ];
  @override
  List<AssetMetadata>? getAssetVariants(String key) => null;
}

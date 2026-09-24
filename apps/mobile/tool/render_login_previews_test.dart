// Run explicitly: flutter test --dart-define=LOGIN_PREVIEWS=true
//   tool/render_login_previews_test.dart --reporter expanded
// Renders the real login page with local assets and fake authentication.
// No account data or Firebase connection is used in these review images.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/screens/login_page.dart';
import 'package:guardian/services/auth_service.dart';
import 'package:guardian/services/push_service.dart';
import 'package:guardian/theme/colors.dart';

const _enabled = bool.fromEnvironment('LOGIN_PREVIEWS');

void main() {
  for (final preview in [
    (name: 'wide', width: 1440.0, height: 1200.0, dark: false, register: false),
    (
      name: 'mobile',
      width: 390.0,
      height: 1500.0,
      dark: false,
      register: false,
    ),
    (
      name: 'mobile_viewport',
      width: 400.0,
      height: 730.0,
      dark: false,
      register: false,
    ),
    (
      name: 'mobile_dark',
      width: 390.0,
      height: 1500.0,
      dark: true,
      register: false,
    ),
    (
      name: 'register',
      width: 390.0,
      height: 1650.0,
      dark: false,
      register: true,
    ),
  ]) {
    testWidgets('render ${preview.name} login preview', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(preview.width, preview.height);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.runAsync(() async {
        final fontPath =
            Platform.environment['LOGIN_PREVIEW_FONT'] ??
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
        final font = FontLoader('LoginPreview');
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

      final db = FakeFirebaseFirestore();
      final auth = AuthService(
        auth: MockFirebaseAuth(),
        db: db,
        push: PushService(db: db),
      );
      final colors = preview.dark
          ? GuardianThemeColors.dark
          : GuardianThemeColors.light;
      final brightness = preview.dark ? Brightness.dark : Brightness.light;
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            useMaterial3: true,
            brightness: brightness,
            fontFamily: 'LoginPreview',
            scaffoldBackgroundColor: colors.canvas,
            extensions: [colors],
            colorScheme: ColorScheme.fromSeed(
              seedColor: colors.accent,
              brightness: brightness,
              surface: colors.surface,
            ),
          ),
          home: RepaintBoundary(
            key: boundaryKey,
            child: LoginPage(authService: auth),
          ),
        ),
      );
      await tester.runAsync(() async {
        await precacheImage(
          const AssetImage('assets/images/guardian_family_welcome.webp'),
          tester.element(find.byType(LoginPage)),
        );
      });
      await tester.pumpAndSettle();
      if (preview.register) {
        final toggle = find.byKey(const ValueKey('login-mode-toggle'));
        await tester.ensureVisible(toggle);
        await tester.tap(toggle);
        await tester.pumpAndSettle();
      }
      expect(tester.takeException(), isNull);

      final boundary =
          boundaryKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        image.dispose();
        if (data == null) throw StateError('Login PNG encoding failed');
        final bytes = data.buffer.asUint8List(
          data.offsetInBytes,
          data.lengthInBytes,
        );
        final directory = Directory('build/login-previews');
        await directory.create(recursive: true);
        await File('${directory.path}/${preview.name}.png').writeAsBytes(bytes);
        // This explicit tool output lets a reviewer recover the PNG from an
        // authenticated CI log without access to artifact download endpoints.
        // ignore: avoid_print
        print('LOGIN_PREVIEW_${preview.name}=${base64Encode(bytes)}');
      });
    }, skip: !_enabled);
  }
}

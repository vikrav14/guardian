import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/services/movement_reminders_service.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/wellness/movement_reminders_page.dart';

import 'render_wellness_previews_test.dart' show loadPreviewFonts;

class PreviewMovementClient implements MovementReminderClient {
  @override
  Future<MovementState> load(String imei) async => const MovementState(connected: true);
  @override
  Future<MovementState> save(String imei, {required String requestId,
    required int expectedVersion, required MovementSettings settings}) async =>
      throw StateError('Synthetic preview does not send commands');
}

void main() {
  for (final size in [const Size(390, 1500), const Size(1280, 1050)]) {
    testWidgets('render movement reminder ${size.width.toInt()}', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = size;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await loadPreviewFonts(tester);
      final key = GlobalKey();
      await tester.pumpWidget(MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(useMaterial3: true, fontFamily: 'WellnessPreview',
          extensions: [GuardianThemeColors.light],
          colorScheme: ColorScheme.fromSeed(seedColor: GuardianThemeColors.light.accent)),
        home: RepaintBoundary(key: key, child: MovementRemindersPage(
          imei: '999999999999999', pilotImei: '999999999999999', name: 'Test wearer',
          client: PreviewMovementClient(), subscription: GuardianSubscription.fromMap({
            'version': 1, 'managedBy': 'guardian_admin', 'plan': 'family', 'status': 'active',
          }),
        )),
      ));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        image.dispose();
        final directory = Directory('build/movement-reminder-previews');
        await directory.create(recursive: true);
        await File('${directory.path}/movement_${size.width.toInt()}.png').writeAsBytes(data!.buffer.asUint8List());
      });
    }, skip: !const bool.fromEnvironment('MOVEMENT_PREVIEWS'));
  }
}

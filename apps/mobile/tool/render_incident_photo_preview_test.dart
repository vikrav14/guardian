// Render only synthetic data; no watch photos or private descriptions are fixtures.
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/incident_photos.dart';
import 'package:guardian/screens/incident_photo_page.dart';
import 'package:guardian/services/safety_snapshot_service.dart';
import 'package:guardian/theme/app_theme.dart';

class PreviewIncidentService extends SafetySnapshotService {
  PreviewIncidentService(this.bytes)
    : super(baseUrl: 'https://example.test', token: () async => 'unused');
  final Uint8List bytes;
  @override
  Future<IncidentPhotoFeed> loadIncident(String id) async => IncidentPhotoFeed(
    type: 'sos',
    state: 'collecting',
    eventAt: DateTime.now(),
    photos: [
      IncidentPhoto(
        id: 'synthetic',
        sequence: 1,
        state: 'available',
        receivedAt: DateTime.now(),
        expiresAt: DateTime.now().add(const Duration(hours: 24)),
        analysis: {
          'status': 'ready',
          'visibleDetails': ['Pale walls and furniture are visible.'],
          'uncertainDetails': ['The nearby surface may be upholstery.'],
          'limitations': ['The tilted view does not show the wearer.'],
        },
      ),
    ],
  );
  @override
  Future<Uint8List> loadImage(String id) async => bytes;
}

void main() {
  for (final width in [390.0, 1280.0]) {
    testWidgets(
      'render incident gallery $width',
      (tester) async {
        tester.view.physicalSize = Size(width, 1600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.runAsync(() async {
          final font = FontLoader('IncidentPreview')
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
          final icons = FontLoader('MaterialIcons')
            ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
          await icons.load();
        });
        final bytes = (await tester.runAsync(() async {
          final recorder = ui.PictureRecorder();
          final canvas = Canvas(recorder);
          canvas.drawRect(
            const Rect.fromLTWH(0, 0, 240, 240),
            Paint()..color = const Color(0xffe6e1d9),
          );
          canvas.drawRect(
            const Rect.fromLTWH(140, 80, 70, 120),
            Paint()..color = const Color(0xff66777b),
          );
          canvas.drawRRect(
            RRect.fromRectAndRadius(
              const Rect.fromLTWH(0, 160, 160, 80),
              const Radius.circular(32),
            ),
            Paint()..color = const Color(0xffaaa9a0),
          );
          final scene = await recorder.endRecording().toImage(240, 240);
          final bytes = (await scene.toByteData(
            format: ui.ImageByteFormat.png,
          ))!.buffer.asUint8List();
          scene.dispose();
          return bytes;
        }))!;
        final key = GlobalKey();
        await tester.pumpWidget(
          MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: ThemeData(
              useMaterial3: true,
              fontFamily: 'IncidentPreview',
              scaffoldBackgroundColor: GuardianThemeColors.light.canvas,
              colorScheme: ColorScheme.fromSeed(
                seedColor: GuardianThemeColors.light.accent,
                surface: GuardianThemeColors.light.surface,
              ),
            ),
            home: RepaintBoundary(
              key: key,
              child: IncidentPhotoPage(
                incidentId: 'synthetic',
                service: PreviewIncidentService(bytes),
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.runAsync(() async {
          await precacheImage(MemoryImage(bytes), key.currentContext!);
        });
        await tester.pumpAndSettle();
        expect(tester.widget<RawImage>(find.byType(RawImage)).image, isNotNull);
        expect(tester.takeException(), isNull);
        final boundary =
            key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await boundary.toImage(pixelRatio: 1);
          final png = await image.toByteData(format: ui.ImageByteFormat.png);
          final dir = Directory('build/incident-photo-previews');
          dir.createSync(recursive: true);
          File(
            '${dir.path}/incident-${width.toInt()}.png',
          ).writeAsBytesSync(png!.buffer.asUint8List());
          image.dispose();
        });
        await tester.pumpWidget(const SizedBox());
      },
      skip: !const bool.fromEnvironment('INCIDENT_PREVIEWS'),
    );
  }
}

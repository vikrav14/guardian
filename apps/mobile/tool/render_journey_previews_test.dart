// flutter test --dart-define=JOURNEY_PREVIEWS=true tool/render_journey_previews_test.dart
// Real Flutter layout with invented records and an illustrative native-map stub.
// This does not request map tiles, Firebase data, or routing services.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
// Use the app's locked Maps platform boundary without adding a dependency.
// ignore: depend_on_referenced_packages
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:guardian/theme/app_theme.dart';

import '../test/support/journey_fixture.dart';

const _enabled = bool.fromEnvironment('JOURNEY_PREVIEWS');

void main() {
  for (final preview in [
    (
      name: 'mobile',
      width: 390.0,
      height: 1460.0,
      theme: GuardianThemeId.islandGlass,
    ),
    (
      name: 'mobile_dark',
      width: 390.0,
      height: 1460.0,
      theme: GuardianThemeId.leMorne,
    ),
    (
      name: 'wide',
      width: 1280.0,
      height: 1100.0,
      theme: GuardianThemeId.islandGlass,
    ),
  ]) {
    testWidgets('render ${preview.name} journey', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(preview.width, preview.height);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final previous = GoogleMapsFlutterPlatform.instance;
      GoogleMapsFlutterPlatform.instance = _IllustrativeMaps();
      addTearDown(() => GoogleMapsFlutterPlatform.instance = previous);

      await tester.runAsync(() async {
        final path =
            Platform.environment['JOURNEY_PREVIEW_FONT'] ??
            (Platform.isWindows
                ? r'C:\Windows\Fonts\segoeui.ttf'
                : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
        final font = FontLoader('JourneyPreview');
        font.addFont(
          Future.value(ByteData.sublistView(await File(path).readAsBytes())),
        );
        await font.load();
        final icons = FontLoader('MaterialIcons');
        icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
        await icons.load();
      });
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(
        journeyFixtureHost(
          themeId: preview.theme,
          fontFamily: 'JourneyPreview',
          boundaryKey: boundaryKey,
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.takeException(), isNull);
      final boundary =
          boundaryKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 2);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        image.dispose();
        if (bytes == null) throw StateError('Journey PNG encoding failed');
        final directory = Directory('build/journey-previews');
        await directory.create(recursive: true);
        await File('${directory.path}/${preview.name}.png').writeAsBytes(
          bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes),
        );
      });
    }, skip: !_enabled);
  }
}

class _IllustrativeMaps extends MethodChannelGoogleMapsFlutter {
  @override
  Widget buildViewWithConfiguration(
    int creationId,
    PlatformViewCreatedCallback onPlatformViewCreated, {
    required MapWidgetConfiguration widgetConfiguration,
    MapConfiguration mapConfiguration = const MapConfiguration(),
    MapObjects mapObjects = const MapObjects(),
  }) => Builder(
    builder: (context) => CustomPaint(
      painter: _MapPainter(
        mapObjects,
        // Match the existing map's light base style in both app themes.
        false,
      ),
      child: const SizedBox.expand(),
    ),
  );
}

class _MapPainter extends CustomPainter {
  const _MapPainter(this.objects, this.dark);
  final MapObjects objects;
  final bool dark;

  @override
  void paint(Canvas canvas, Size size) {
    final background = dark ? const Color(0xFF25332E) : const Color(0xFFF0F1E9);
    final road = dark ? const Color(0xFF49564F) : Colors.white;
    canvas.drawRect(Offset.zero & size, Paint()..color = background);
    Offset project(double lat, double lng) => Offset(
      30 + (lng - 57.578) / 0.010 * (size.width - 60),
      65 + (-20.013 - lat) / 0.009 * (size.height - 90),
    );
    Path line(List<(double, double)> points) {
      final path = Path();
      for (var i = 0; i < points.length; i++) {
        final point = project(points[i].$1, points[i].$2);
        if (i == 0) {
          path.moveTo(point.dx, point.dy);
        } else {
          path.lineTo(point.dx, point.dy);
        }
      }
      return path;
    }

    final park = Rect.fromPoints(
      project(-20.015, 57.5847),
      project(-20.0173, 57.5872),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(park, const Radius.circular(16)),
      Paint()..color = dark ? const Color(0xFF354B3A) : const Color(0xFFD9E6C9),
    );
    for (var y = 0; y < 6; y++) {
      for (var x = 0; x < 6; x++) {
        final point = project(-20.0129 - y * 0.002, 57.5775 + x * 0.002);
        final rect = Rect.fromLTWH(point.dx + 10, point.dy + 10, 18, 20);
        if (!park.overlaps(rect)) {
          canvas.drawRRect(
            RRect.fromRectAndRadius(rect, const Radius.circular(3)),
            Paint()
              ..color = dark
                  ? const Color(0xFF32413A)
                  : const Color(0xFFE3E5DA),
          );
        }
      }
    }
    final roads = <Path>[
      for (var i = 0; i < 6; i++)
        line([(-20.013 - i * 0.002, 57.575), (-20.013 - i * 0.002, 57.592)]),
      for (var i = 0; i < 6; i++)
        line([(-20.01, 57.576 + i * 0.002), (-20.025, 57.576 + i * 0.002)]),
      line([(-20.020, 57.576), (-20.020, 57.590)]),
      line([(-20.016, 57.576), (-20.016, 57.590)]),
    ];
    for (final path in roads) {
      canvas.drawPath(
        path,
        Paint()
          ..color = road
          ..style = PaintingStyle.stroke
          ..strokeWidth = 9,
      );
    }
    final polylines = objects.polylines.toList()
      ..sort((a, b) => a.zIndex.compareTo(b.zIndex));
    for (final polyline in polylines) {
      canvas.drawPath(
        line([for (final p in polyline.points) (p.latitude, p.longitude)]),
        Paint()
          ..color = polyline.color
          ..style = PaintingStyle.stroke
          ..strokeWidth = polyline.width.toDouble()
          ..strokeJoin = StrokeJoin.round
          ..strokeCap = StrokeCap.round,
      );
    }
    final home = project(-20.020, 57.580);
    canvas.drawCircle(home, 13, Paint()..color = Colors.white);
    canvas.drawCircle(home, 9, Paint()..color = const Color(0xFF4F5CCB));
    final stop = project(-20.016, 57.586);
    canvas.drawCircle(stop, 6, Paint()..color = Colors.white);
    canvas.drawCircle(stop, 3, Paint()..color = const Color(0xFF4F5CCB));
    void label(String value, Offset offset, {double fontSize = 11}) {
      final text = TextPainter(
        text: TextSpan(
          text: value,
          style: TextStyle(
            fontFamily: 'JourneyPreview',
            fontSize: fontSize,
            color: dark ? const Color(0xFFC9D4CC) : const Color(0xFF657364),
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: size.width - 20);
      text.paint(canvas, offset);
    }

    label('Home', home + const Offset(-12, 17));
    label('Sample garden', stop + const Offset(-44, -23));
    label(
      'Illustrative map · sample data',
      Offset(10, size.height - 20),
      fontSize: 10,
    );
  }

  @override
  bool shouldRepaint(covariant _MapPainter oldDelegate) => true;
}

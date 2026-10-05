import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

/// Two small, static map labels per journey. Render once when the labels or
/// theme change; replay frames must never recreate native marker bitmaps.
Future<BitmapDescriptor> journeyEndpointIcon({
  required String caption,
  required String time,
  required bool departure,
  required Color surface,
  required Color foreground,
  required double pixelRatio,
}) async {
  const width = 180.0;
  const height = 58.0;
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)..scale(pixelRatio);
  final top = departure ? 0.0 : 30.0;
  final bubble = RRect.fromRectAndRadius(
    Rect.fromLTWH(0, top, width, 28),
    const Radius.circular(7),
  );
  canvas.drawRRect(bubble, Paint()..color = surface);
  canvas.drawRRect(
    bubble,
    Paint()
      ..color = foreground.withValues(alpha: 0.22)
      ..style = PaintingStyle.stroke,
  );
  final timeText = TextPainter(
    text: TextSpan(
      text: time,
      style: TextStyle(
        color: foreground,
        fontSize: 11,
        fontWeight: FontWeight.w600,
      ),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  final captionText = TextPainter(
    text: TextSpan(
      text: caption,
      style: TextStyle(color: foreground, fontSize: 11),
    ),
    textDirection: TextDirection.ltr,
    maxLines: 1,
    ellipsis: '…',
  )..layout(maxWidth: width - timeText.width - 24);
  captionText.paint(canvas, Offset(8, top + (28 - captionText.height) / 2));
  timeText.paint(
    canvas,
    Offset(width - timeText.width - 8, top + (28 - timeText.height) / 2),
  );
  final center = Offset(width / 2, departure ? 53 : 5);
  canvas.drawCircle(center, 5, Paint()..color = surface);
  if (departure) {
    canvas.drawCircle(
      center,
      3,
      Paint()
        ..color = foreground
        ..strokeWidth = 1.5
        ..style = PaintingStyle.stroke,
    );
  } else {
    canvas.drawRect(
      Rect.fromCenter(center: center, width: 6, height: 6),
      Paint()..color = foreground,
    );
  }
  final picture = recorder.endRecording();
  ui.Image? image;
  try {
    image = await picture.toImage(
      (width * pixelRatio).ceil(),
      (height * pixelRatio).ceil(),
    );
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.bytes(
      bytes!.buffer.asUint8List(),
      width: width,
      height: height,
    );
  } finally {
    image?.dispose();
    picture.dispose();
    captionText.dispose();
    timeText.dispose();
  }
}

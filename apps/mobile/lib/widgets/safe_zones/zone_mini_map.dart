import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../models/geofence.dart';
import '../../safe_zones/safe_zone_logic.dart';
import '../../theme/app_theme.dart';

/// Lightweight zone preview — CustomPaint circle + optional wearer dot.
///
/// Avoids embedding [GoogleMap] in scroll lists for performance. Phase 2 could
/// swap in a live map tile when a static key is available.
class ZoneMiniMapPreview extends StatelessWidget {
  const ZoneMiniMapPreview({
    super.key,
    required this.zone,
    this.device,
    this.height = 120,
  });

  final Geofence zone;
  final Device? device;
  final double height;

  @override
  Widget build(BuildContext context) {
    final style = styleForZone(zone);
    return ClipRRect(
      borderRadius: BorderRadius.circular(GuardianRadius.medium),
      child: SizedBox(
        height: height,
        width: double.infinity,
        child: CustomPaint(
          painter: _ZoneMiniMapPainter(
            zone: zone,
            device: device,
            tint: style.background,
            accent: style.color,
          ),
        ),
      ),
    );
  }
}

class _ZoneMiniMapPainter extends CustomPainter {
  _ZoneMiniMapPainter({
    required this.zone,
    required this.device,
    required this.tint,
    required this.accent,
  });

  final Geofence zone;
  final Device? device;
  final Color tint;
  final Color accent;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = tint);

    final gridPaint = Paint()
      ..color = accent.withValues(alpha: 0.08)
      ..strokeWidth = 1;
    const gridStep = 18.0;
    for (var x = 0.0; x <= size.width; x += gridStep) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), gridPaint);
    }
    for (var y = 0.0; y <= size.height; y += gridStep) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    final center = Offset(size.width / 2, size.height / 2);
    final radiusPx = math.min(size.width, size.height) * 0.28;

    canvas.drawCircle(
      center,
      radiusPx,
      Paint()
        ..color = accent.withValues(alpha: 0.18)
        ..style = PaintingStyle.fill,
    );
    canvas.drawCircle(
      center,
      radiusPx,
      Paint()
        ..color = accent
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );

    final pinPaint = Paint()..color = accent;
    canvas.drawCircle(center, 5, pinPaint);
    canvas.drawCircle(center, 2.5, Paint()..color = Colors.white);

    final location = device?.location;
    if (location != null &&
        location.isValid &&
        !(zone.lat == 0 && zone.lng == 0)) {
      final distance = haversineMeters(
        location.lat,
        location.lng,
        zone.lat,
        zone.lng,
      );
      final bearing = _bearing(zone.lat, zone.lng, location.lat, location.lng);
      final scale = radiusPx / zone.radiusMeters.clamp(1, double.infinity);
      final offsetMeters = distance.clamp(0, zone.radiusMeters * 1.8);
      final dx = math.sin(bearing) * offsetMeters * scale;
      final dy = -math.cos(bearing) * offsetMeters * scale;
      final wearerCenter = center + Offset(dx, dy);
      final inside = distance <= zone.radiusMeters;
      canvas.drawCircle(
        wearerCenter,
        6,
        Paint()..color = inside ? GuardianColors.safe : GuardianColors.warning,
      );
      canvas.drawCircle(
        wearerCenter,
        6,
        Paint()
          ..color = Colors.white
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }
  }

  double _bearing(double lat1, double lng1, double lat2, double lng2) {
    final dLng = (lng2 - lng1) * math.pi / 180;
    final lat1Rad = lat1 * math.pi / 180;
    final lat2Rad = lat2 * math.pi / 180;
    final y = math.sin(dLng) * math.cos(lat2Rad);
    final x =
        math.cos(lat1Rad) * math.sin(lat2Rad) -
        math.sin(lat1Rad) * math.cos(lat2Rad) * math.cos(dLng);
    return math.atan2(y, x);
  }

  @override
  bool shouldRepaint(covariant _ZoneMiniMapPainter oldDelegate) {
    return oldDelegate.zone != zone ||
        oldDelegate.device != device ||
        oldDelegate.tint != tint ||
        oldDelegate.accent != accent;
  }
}

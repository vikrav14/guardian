import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/colors.dart';

/// Guardian brand mark — 3D dodo mascot with radar rings and location pin.
class GuardianBrandMark extends StatelessWidget {
  const GuardianBrandMark({
    super.key,
    this.size = 38,
    this.borderRadius = 12,
    this.iconScale = 0.55,
    this.showShadow = true,
  });

  static const assetPath = 'assets/brand/guardian_dodo.png';

  final double size;
  final double borderRadius;

  /// Kept for call-site compatibility; the asset fills the mark.
  final double iconScale;
  final bool showShadow;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(borderRadius);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: showShadow
            ? [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.12),
                  blurRadius: size * 0.28,
                  offset: Offset(0, size * 0.06),
                ),
              ]
            : null,
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: Image.asset(
          assetPath,
          width: size,
          height: size,
          fit: BoxFit.cover,
          semanticLabel: 'Guardian',
        ),
      ),
    );
  }
}

/// Compact AI badge — full dodo mascot with sparkle accents and an AI pill
/// over the asset's location pin (sidebar [GuardianBrandMark] keeps the pin).
class GuardianAiIcon extends StatelessWidget {
  const GuardianAiIcon({
    super.key,
    this.size = 44,
    this.backgroundColor,
    this.accentColor,
    this.warning = false,
  });

  /// Dark plumage-matched palette for the AI pill and sparkle accents.
  static const aiBadgeBackground = Color(0xFF1B4D4A);
  static const aiBadgeText = Color(0xFFE8F5F0);
  static const aiSparklePrimary = Color(0xFF2A6B66);
  static const aiSparkleSoft = Color(0xFF1B4D4A);

  final double size;
  final Color? backgroundColor;
  final Color? accentColor;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    final background = backgroundColor ?? GuardianColors.safeBg;
    final accent = accentColor ?? GuardianColors.safe;

    return SizedBox(
      width: size,
      height: size,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: background,
          shape: BoxShape.circle,
        ),
        child: warning
            ? Icon(
                Icons.warning_amber_rounded,
                color: accent,
                size: size * 0.52,
              )
            : Stack(
                fit: StackFit.expand,
                children: [
                  ClipOval(
                    child: Padding(
                      padding: EdgeInsets.all(size * 0.06),
                      child: Image.asset(
                        GuardianBrandMark.assetPath,
                        fit: BoxFit.contain,
                        alignment: Alignment.center,
                        semanticLabel: 'Guardian AI',
                      ),
                    ),
                  ),
                  CustomPaint(
                    painter: _AiSparklePainter(
                      primaryColor: aiSparklePrimary,
                      softColor: aiSparkleSoft,
                      size: size,
                    ),
                  ),
                  Positioned(
                    right: size * 0.03,
                    bottom: size * 0.03,
                    child: _AiPinCoverBadge(size: size),
                  ),
                ],
              ),
      ),
    );
  }
}

class _AiPinCoverBadge extends StatelessWidget {
  const _AiPinCoverBadge({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    final badgeSize = size * 0.31;
    final borderWidth = size * 0.028;

    return Container(
      width: badgeSize,
      height: badgeSize,
      decoration: BoxDecoration(
        color: GuardianAiIcon.aiBadgeBackground,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: borderWidth),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.14),
            blurRadius: size * 0.04,
            offset: Offset(0, size * 0.015),
          ),
        ],
      ),
      alignment: Alignment.center,
      child: Text(
        'AI',
        style: TextStyle(
          color: GuardianAiIcon.aiBadgeText,
          fontSize: size * 0.105,
          fontWeight: FontWeight.w800,
          height: 1,
          letterSpacing: -0.4,
        ),
      ),
    );
  }
}

class _AiSparklePainter extends CustomPainter {
  _AiSparklePainter({
    required this.primaryColor,
    required this.softColor,
    required this.size,
  });

  final Color primaryColor;
  final Color softColor;
  final double size;

  @override
  void paint(Canvas canvas, Size canvasSize) {
    _drawSparkle(
      canvas,
      Offset(canvasSize.width * 0.76, canvasSize.height * 0.24),
      size * 0.11,
      primaryColor.withValues(alpha: 0.88),
    );
    _drawSparkle(
      canvas,
      Offset(canvasSize.width * 0.58, canvasSize.height * 0.14),
      size * 0.055,
      softColor.withValues(alpha: 0.42),
    );
  }

  void _drawSparkle(Canvas canvas, Offset center, double radius, Color fill) {
    final path = Path();
    for (var i = 0; i < 8; i++) {
      final angle = i * math.pi / 4;
      final r = i.isEven ? radius : radius * 0.35;
      final point = center + Offset(math.cos(angle) * r, math.sin(angle) * r);
      if (i == 0) {
        path.moveTo(point.dx, point.dy);
      } else {
        path.lineTo(point.dx, point.dy);
      }
    }
    path.close();
    canvas.drawPath(path, Paint()..color = fill);
  }

  @override
  bool shouldRepaint(covariant _AiSparklePainter oldDelegate) {
    return oldDelegate.primaryColor != primaryColor ||
        oldDelegate.softColor != softColor ||
        oldDelegate.size != size;
  }
}

import 'package:flutter/material.dart';

import '../../theme/colors.dart';

/// A decorative section marker, deliberately separate from live status badges.
class DashboardSectionIcon extends StatelessWidget {
  const DashboardSectionIcon({super.key, required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final ink = Color.lerp(colors.textPrimary, colors.accent, .35)!;
    final tint = colors.accent.withValues(alpha: isDark ? .10 : .065);
    final glyph = _SectionGlyph.fromIcon(icon);

    return ExcludeSemantics(
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: Color.alphaBlend(tint, colors.surface),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Color.alphaBlend(tint, colors.border)),
        ),
        alignment: Alignment.center,
        child: glyph == null
            ? Icon(icon, color: ink, size: 23)
            : CustomPaint(
                size: const Size.square(24),
                painter: _SectionGlyphPainter(
                  glyph: glyph,
                  ink: ink,
                  wash: ink.withValues(alpha: isDark ? .18 : .10),
                ),
              ),
      ),
    );
  }
}

enum _SectionGlyph {
  location,
  shield,
  intelligence,
  calendar;

  static _SectionGlyph? fromIcon(IconData icon) {
    if (icon == Icons.location_on_outlined) return location;
    if (icon == Icons.shield_outlined) return shield;
    if (icon == Icons.auto_awesome_outlined) return intelligence;
    if (icon == Icons.calendar_today_outlined) return calendar;
    return null;
  }
}

class _SectionGlyphPainter extends CustomPainter {
  const _SectionGlyphPainter({
    required this.glyph,
    required this.ink,
    required this.wash,
  });

  final _SectionGlyph glyph;
  final Color ink;
  final Color wash;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 24, size.height / 24);
    final stroke = Paint()
      ..color = ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.65
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final fill = Paint()..color = wash;

    switch (glyph) {
      case _SectionGlyph.location:
        final pin = Path()
          ..moveTo(12, 20)
          ..cubicTo(9.4, 17.1, 5.4, 13.1, 5.4, 8.8)
          ..cubicTo(5.4, 0.4, 18.6, 0.4, 18.6, 8.8)
          ..cubicTo(18.6, 13.1, 14.6, 17.1, 12, 20)
          ..close();
        canvas.drawPath(pin, fill);
        canvas.drawPath(pin, stroke);
        canvas.drawCircle(const Offset(12, 8.8), 2.5, stroke);
        canvas.drawPath(
          Path()
            ..moveTo(7.5, 20.4)
            ..cubicTo(5.5, 22.5, 18.5, 22.5, 16.5, 20.4),
          stroke..color = ink.withValues(alpha: .5),
        );
      case _SectionGlyph.shield:
        final shield = Path()
          ..moveTo(12, 2.2)
          ..cubicTo(14.4, 3.7, 17.1, 4.4, 20, 4.9)
          ..lineTo(20, 10.6)
          ..cubicTo(20, 15.9, 17, 19.3, 12, 21.7)
          ..cubicTo(7, 19.3, 4, 15.9, 4, 10.6)
          ..lineTo(4, 4.9)
          ..cubicTo(6.9, 4.4, 9.6, 3.7, 12, 2.2)
          ..close();
        canvas.drawPath(shield, fill);
        canvas.drawPath(shield, stroke);
        canvas.drawPath(
          Path()
            ..moveTo(12, 6)
            ..lineTo(12, 17.4)
            ..cubicTo(15.1, 15.6, 16.5, 13.4, 16.5, 10.6)
            ..lineTo(16.5, 7.7)
            ..quadraticBezierTo(14.1, 7, 12, 6)
            ..close(),
          fill,
        );
      case _SectionGlyph.intelligence:
        final sparkle = Path()
          ..moveTo(10, 4.8)
          ..quadraticBezierTo(11.6, 10.4, 17.2, 12)
          ..quadraticBezierTo(11.6, 13.6, 10, 19.2)
          ..quadraticBezierTo(8.4, 13.6, 2.8, 12)
          ..quadraticBezierTo(8.4, 10.4, 10, 4.8)
          ..close();
        canvas.drawPath(sparkle, fill);
        canvas.drawPath(sparkle, stroke);
        canvas.drawPath(
          Path()
            ..moveTo(19.2, 2)
            ..lineTo(19.2, 7.6)
            ..moveTo(16.4, 4.8)
            ..lineTo(22, 4.8)
            ..moveTo(19.2, 17.4)
            ..lineTo(19.2, 21.4)
            ..moveTo(17.2, 19.4)
            ..lineTo(21.2, 19.4),
          stroke,
        );
      case _SectionGlyph.calendar:
        final frame = RRect.fromRectAndRadius(
          const Rect.fromLTRB(3, 4.8, 21, 21),
          const Radius.circular(3),
        );
        canvas.drawRRect(frame, fill);
        canvas.drawRRect(frame, stroke);
        canvas.drawPath(
          Path()
            ..moveTo(3, 10)
            ..lineTo(21, 10)
            ..moveTo(7.5, 2.4)
            ..lineTo(7.5, 6.8)
            ..moveTo(16.5, 2.4)
            ..lineTo(16.5, 6.8),
          stroke,
        );
        final day = Paint()..color = ink;
        for (final point in const [
          Offset(7.5, 14),
          Offset(12, 14),
          Offset(16.5, 14),
          Offset(7.5, 17.5),
          Offset(12, 17.5),
        ]) {
          canvas.drawCircle(point, .85, day);
        }
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _SectionGlyphPainter oldDelegate) =>
      glyph != oldDelegate.glyph ||
      ink != oldDelegate.ink ||
      wash != oldDelegate.wash;
}

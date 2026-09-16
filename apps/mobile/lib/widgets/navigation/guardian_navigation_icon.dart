import 'package:flutter/material.dart';

enum GuardianNavigationSymbol { home, safeZones, alerts, account, sos }

/// Small native vectors keep the navigation's two-tone treatment consistent
/// across platforms without an additional icon font or image dependency.
class GuardianNavigationIcon extends StatelessWidget {
  const GuardianNavigationIcon({
    super.key,
    required this.symbol,
    required this.color,
    this.selected = false,
    this.highContrast = false,
  });

  final GuardianNavigationSymbol symbol;
  final Color color;
  final bool selected, highContrast;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox.square(
      dimension: 28,
      child: CustomPaint(
        painter: _NavigationIconPainter(
          symbol: symbol,
          color: color,
          fill: color.withValues(
            alpha: highContrast
                ? 0
                : selected
                ? .17
                : .09,
          ),
          strokeWidth: highContrast ? 2.2 : 1.8,
        ),
      ),
    ),
  );
}

class _NavigationIconPainter extends CustomPainter {
  const _NavigationIconPainter({
    required this.symbol,
    required this.color,
    required this.fill,
    required this.strokeWidth,
  });

  final GuardianNavigationSymbol symbol;
  final Color color, fill;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 24, size.height / 24);
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final wash = Paint()..color = fill;
    void shape(Path path) {
      canvas.drawPath(path, wash);
      canvas.drawPath(path, stroke);
    }

    switch (symbol) {
      case GuardianNavigationSymbol.home:
        shape(
          Path()
            ..moveTo(3, 10)
            ..lineTo(10.7, 3.6)
            ..quadraticBezierTo(12, 2.6, 13.3, 3.6)
            ..lineTo(21, 10)
            ..lineTo(20, 10)
            ..lineTo(20, 19.5)
            ..quadraticBezierTo(20, 21, 18.5, 21)
            ..lineTo(5.5, 21)
            ..quadraticBezierTo(4, 21, 4, 19.5)
            ..lineTo(4, 10)
            ..close(),
        );
        canvas.drawPath(
          Path()
            ..moveTo(9, 21)
            ..lineTo(9, 14)
            ..lineTo(15, 14)
            ..lineTo(15, 21),
          stroke,
        );
      case GuardianNavigationSymbol.safeZones:
      case GuardianNavigationSymbol.sos:
        shape(
          Path()
            ..moveTo(12, 2.8)
            ..lineTo(20, 6.2)
            ..lineTo(20, 12.4)
            ..quadraticBezierTo(20, 18, 12, 21.5)
            ..quadraticBezierTo(4, 18, 4, 12.4)
            ..lineTo(4, 6.2)
            ..close(),
        );
        if (symbol == GuardianNavigationSymbol.safeZones) {
          canvas.drawPath(
            Path()
              ..moveTo(8.2, 11.9)
              ..lineTo(10.6, 14.3)
              ..lineTo(15.8, 9.2),
            stroke,
          );
        } else {
          canvas.drawLine(const Offset(12, 8), const Offset(12, 12.5), stroke);
          canvas.drawCircle(const Offset(12, 16), 1, Paint()..color = color);
        }
      case GuardianNavigationSymbol.alerts:
        shape(
          Path()
            ..moveTo(6.5, 10)
            ..cubicTo(6.5, 3.8, 17.5, 3.8, 17.5, 10)
            ..lineTo(17.5, 13.8)
            ..quadraticBezierTo(17.5, 15.8, 19, 17)
            ..lineTo(5, 17)
            ..quadraticBezierTo(6.5, 15.8, 6.5, 13.8)
            ..close(),
        );
        canvas.drawPath(
          Path()
            ..moveTo(9.5, 20)
            ..quadraticBezierTo(12, 22, 14.5, 20)
            ..moveTo(3.5, 6)
            ..quadraticBezierTo(2, 7.5, 2, 10)
            ..moveTo(20.5, 6)
            ..quadraticBezierTo(22, 7.5, 22, 10),
          stroke,
        );
      case GuardianNavigationSymbol.account:
        canvas.drawCircle(const Offset(12, 12), 9, wash);
        canvas.drawCircle(const Offset(12, 12), 9, stroke);
        canvas.drawCircle(const Offset(12, 9), 2.8, stroke);
        canvas.drawPath(
          Path()
            ..moveTo(6, 18.4)
            ..cubicTo(7, 13.5, 17, 13.5, 18, 18.4),
          stroke,
        );
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _NavigationIconPainter oldDelegate) =>
      symbol != oldDelegate.symbol ||
      color != oldDelegate.color ||
      fill != oldDelegate.fill ||
      strokeWidth != oldDelegate.strokeWidth;
}

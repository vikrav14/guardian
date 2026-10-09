import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/colors.dart';

const _gold = Color(0xFFF3A712);

/// Guardian's family mark: two adults and a child with a heart, beneath a
/// location pin and inside the open Mauritius-colour ring.
/// Shared by the launcher, startup screen and all in-app brand lockups.
class GuardianPinMark extends StatelessWidget {
  const GuardianPinMark({
    super.key,
    this.size = 44,
    this.pulse,
    this.fillProgress = 1,
  }) : assert(fillProgress >= 0 && fillProgress <= 1);

  final double size;

  /// Reveals all coloured details continuously from top to bottom.
  /// The normal in-app mark stays fully coloured by default.
  final double fillProgress;

  /// Shares the location dot's blink with the nearby [GuardianWordmark].
  final Animation<double>? pulse;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Guardian',
    image: true,
    child: SizedBox.square(
      dimension: size,
      child: CustomPaint(painter: _GuardianFamilyPainter(fillProgress, pulse)),
    ),
  );
}

/// Normalized vector artwork keeps the supplied family design crisp at both
/// header and launcher sizes. One downward clip reveals every coloured part.
class _GuardianFamilyPainter extends CustomPainter {
  _GuardianFamilyPainter(this.fillProgress, this.pulse) : super(repaint: pulse);

  final double fillProgress;
  final Animation<double>? pulse;

  static const _familyInk = Color(0xFF14262D);
  static const _grey = Color(0xFFE5E9E7);
  static const _mint = Color(0xFF8DD5B5);
  static const _heartGreen = Color(0xFF007946);
  static const _flagColours = [
    Color(0xFFF51320),
    Color(0xFF003080),
    Color(0xFFFFE000),
    Color(0xFF009F4D),
  ];
  // Sloping colour joins and the open, rounded bottom follow the reference.
  static const _bandEdges = [
    [0.0, 0.0],
    [0.208, 0.124],
    [0.467, 0.253],
    [0.813, 0.637],
    [1.0, 1.0],
  ];
  static const _ringBounds = Rect.fromLTWH(0.033, 0.033, 0.934, 0.934);
  static const _dotCenter = Offset(0.5, 0.257);

  static final _pin = Path()
    ..moveTo(0.5, 0.555)
    ..cubicTo(0.470, 0.536, 0.340, 0.367, 0.340, 0.286)
    ..cubicTo(0.340, 0.190, 0.400, 0.123, 0.500, 0.123)
    ..cubicTo(0.600, 0.123, 0.660, 0.190, 0.660, 0.286)
    ..cubicTo(0.660, 0.367, 0.530, 0.536, 0.500, 0.555)
    ..close();

  static final _adult = Path()
    ..moveTo(0.137, 0.695)
    ..cubicTo(0.155, 0.629, 0.203, 0.592, 0.273, 0.592)
    ..cubicTo(0.338, 0.592, 0.393, 0.637, 0.418, 0.695)
    ..cubicTo(0.354, 0.708, 0.321, 0.748, 0.321, 0.804)
    ..cubicTo(0.321, 0.835, 0.330, 0.863, 0.350, 0.890)
    ..cubicTo(0.250, 0.854, 0.173, 0.784, 0.137, 0.695)
    ..close();

  static final _heart = Path()
    ..moveTo(0.500, 0.780)
    ..cubicTo(0.461, 0.721, 0.374, 0.722, 0.374, 0.810)
    ..cubicTo(0.374, 0.861, 0.460, 0.941, 0.500, 0.972)
    ..cubicTo(0.540, 0.941, 0.626, 0.861, 0.626, 0.810)
    ..cubicTo(0.626, 0.722, 0.539, 0.721, 0.500, 0.780)
    ..close();

  void _drawRing(Canvas canvas, Color colour) {
    canvas.drawArc(
      _ringBounds,
      106 * math.pi / 180,
      328 * math.pi / 180,
      false,
      Paint()
        ..color = colour
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.066
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width, size.height);
    final ink = Paint()..color = _familyInk;
    _drawRing(canvas, _grey);
    canvas.drawPath(_pin, ink);
    canvas.drawCircle(_dotCenter, 0.088, Paint()..color = Colors.white);
    canvas.drawCircle(const Offset(0.274, 0.498), 0.071, ink);
    canvas.drawCircle(const Offset(0.726, 0.498), 0.071, ink);
    canvas.drawPath(_adult, ink);
    canvas.save();
    canvas.translate(1, 0);
    canvas.scale(-1, 1);
    canvas.drawPath(_adult, ink);
    canvas.restore();
    canvas.drawCircle(const Offset(0.5, 0.661), 0.056, ink);
    canvas.drawPath(_heart, Paint()..color = _grey);

    final dotOpacity = pulse?.value ?? 1;
    canvas.drawCircle(
      _dotCenter,
      0.058,
      Paint()..color = Color.lerp(Colors.white, _grey, dotOpacity)!,
    );

    canvas.save();
    canvas.clipRect(Rect.fromLTWH(0, 0, 1, fillProgress));
    for (var band = 0; band < _flagColours.length; band++) {
      final top = _bandEdges[band];
      final bottom = _bandEdges[band + 1];
      canvas.save();
      canvas.clipPath(
        Path()
          ..moveTo(0, top[0])
          ..lineTo(1, top[1])
          ..lineTo(1, bottom[1])
          ..lineTo(0, bottom[0])
          ..close(),
        doAntiAlias: false,
      );
      _drawRing(canvas, _flagColours[band]);
      canvas.restore();
    }
    canvas.drawPath(_heart, Paint()..color = _heartGreen);
    canvas.drawCircle(
      _dotCenter,
      0.058,
      Paint()..color = Color.lerp(Colors.white, _mint, dotOpacity)!,
    );
    canvas.restore();
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _GuardianFamilyPainter oldDelegate) =>
      fillProgress != oldDelegate.fillProgress || pulse != oldDelegate.pulse;
}

/// "Guardian" wordmark with a blinking dot on the "i", matching
/// [GuardianPinMark]'s centre dot.
class GuardianWordmark extends StatelessWidget {
  const GuardianWordmark({
    super.key,
    this.fontSize = 24,
    this.pulse,
    this.color,
  });

  final double fontSize;
  final Animation<double>? pulse;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final ink = color ?? context.guardianColors.textPrimary;
    final style = TextStyle(
      fontSize: fontSize,
      fontWeight: FontWeight.w800,
      letterSpacing: -0.8,
      height: 1,
      color: ink,
    );
    final dot = Container(
      width: fontSize * 0.13,
      height: fontSize * 0.13,
      decoration: const BoxDecoration(
        color: GuardianColors.safe,
        shape: BoxShape.circle,
      ),
    );

    return Semantics(
      label: 'Guardian',
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text('Guard', style: style),
          SizedBox(
            width: fontSize * 0.2,
            height: fontSize * 0.72,
            child: Stack(
              alignment: Alignment.bottomCenter,
              children: [
                Container(
                  width: fontSize * 0.09,
                  height: fontSize * 0.42,
                  decoration: BoxDecoration(
                    color: ink,
                    borderRadius: BorderRadius.circular(fontSize * 0.045),
                  ),
                ),
                Positioned(
                  top: 0,
                  child: pulse == null
                      ? dot
                      : FadeTransition(opacity: pulse!, child: dot),
                ),
              ],
            ),
          ),
          Text('a', style: style.copyWith(color: _gold)),
          Text('n', style: style),
        ],
      ),
    );
  }
}

/// Drives both brand marks' dots through one shared green pulse.
class _BlinkCycle extends StatefulWidget {
  const _BlinkCycle({required this.builder});

  final Widget Function(BuildContext context, Animation<double>? pulse) builder;

  @override
  State<_BlinkCycle> createState() => _BlinkCycleState();
}

class _BlinkCycleState extends State<_BlinkCycle>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _opacity;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);
    _opacity = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOut,
    ).drive(Tween(begin: 0.25, end: 1.0));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return widget.builder(context, reduceMotion ? null : _opacity);
  }
}

/// Full header lockup: [GuardianPinMark] beside [GuardianWordmark], both
/// dots pulsing green together. Drop-in replacement for the old
/// shield-icon + plain-text header mark.
class GuardianPinLogo extends StatelessWidget {
  const GuardianPinLogo({
    super.key,
    this.iconSize = 44,
    this.wordmarkSize = 24,
  });

  final double iconSize;
  final double wordmarkSize;

  @override
  Widget build(BuildContext context) {
    return _BlinkCycle(
      builder: (context, pulse) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          GuardianPinMark(size: iconSize, pulse: pulse),
          SizedBox(width: iconSize * 0.25),
          GuardianWordmark(fontSize: wordmarkSize, pulse: pulse),
        ],
      ),
    );
  }
}

/// Header lockup with a caption slot below the wordmark (e.g. the "Know
/// they are safe" tagline) -- same shared pulse as [GuardianPinLogo], just
/// with room for a second line of text instead of forcing a single row.
class GuardianHeaderBrandMark extends StatelessWidget {
  const GuardianHeaderBrandMark({
    super.key,
    this.iconSize = 44,
    this.wordmarkSize = 24,
    this.caption,
  });

  final double iconSize;
  final double wordmarkSize;
  final Widget? caption;

  @override
  Widget build(BuildContext context) {
    return _BlinkCycle(
      builder: (context, pulse) => Row(
        children: [
          GuardianPinMark(size: iconSize, pulse: pulse),
          SizedBox(width: iconSize * 0.25),
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              GuardianWordmark(fontSize: wordmarkSize, pulse: pulse),
              if (caption != null) ...[const SizedBox(height: 4), caption!],
            ],
          ),
        ],
      ),
    );
  }
}

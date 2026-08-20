import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/colors.dart';

/// The Guardian pin mark: a location pin inside a black ring with a gold
/// arc. Pairs with [GuardianWordmark] to form the full logo -- see
/// [GuardianPinLogo] and [GuardianHeaderBrandMark] for the combined lockups
/// that drive both marks' dots from one shared [_BlinkCycle].
const _ink = Color(0xFF14171A);
const _gold = Color(0xFFF3A712);

class GuardianPinMark extends StatelessWidget {
  const GuardianPinMark({super.key, this.size = 44, this.pulse});

  final double size;

  /// Drives the centre dot's blink. Pass the same [Animation] used by a
  /// nearby [GuardianWordmark] so both dots blink in lockstep. When omitted
  /// the dot is drawn solid (no animation).
  final Animation<double>? pulse;

  @override
  Widget build(BuildContext context) {
    final dot = Container(
      width: size * 0.16,
      height: size * 0.16,
      decoration: const BoxDecoration(
        color: GuardianColors.safe,
        shape: BoxShape.circle,
      ),
    );

    return Semantics(
      label: 'Guardian',
      image: true,
      child: SizedBox(
        width: size,
        height: size,
        child: Stack(
          alignment: Alignment.center,
          children: [
            CustomPaint(size: Size(size, size), painter: const _RingPainter()),
            Icon(Icons.location_on, size: size * 0.62, color: _ink),
            Align(
              alignment: const Alignment(0, -0.42),
              child: Container(
                width: size * 0.22,
                height: size * 0.22,
                decoration: const BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: pulse == null
                    ? dot
                    : FadeTransition(opacity: pulse!, child: dot),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  const _RingPainter();

  static const _strokeFactor = 0.1;
  static const _goldStart = 0.44; // ~25°, measured clockwise from 3 o'clock
  static const _goldSweep = 2.27; // ~130°, centred on the bottom (6 o'clock)

  @override
  void paint(Canvas canvas, Size size) {
    final strokeWidth = size.width * _strokeFactor;
    final radius = size.width / 2 - strokeWidth / 2;
    final rect = Rect.fromCircle(
      center: Offset(size.width / 2, size.height / 2),
      radius: radius,
    );

    final gold = Paint()
      ..color = _gold
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;
    final black = Paint()
      ..color = _ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    canvas.drawArc(rect, _goldStart, _goldSweep, false, gold);
    canvas.drawArc(
      rect,
      _goldStart + _goldSweep,
      2 * math.pi - _goldSweep,
      false,
      black,
    );
  }

  @override
  bool shouldRepaint(covariant _RingPainter oldDelegate) => false;
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
    final ink = color ?? _ink;
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

import 'package:flutter/material.dart';

import '../../theme/colors.dart';

/// Soft pulsing satellite — friendly "we're finding them" indicator.
class ReconnectingPulse extends StatefulWidget {
  const ReconnectingPulse({
    super.key,
    this.size = 7,
    this.color = GuardianColors.accent,
    this.iconSize,
  });

  final double size;
  final Color color;
  final double? iconSize;

  @override
  State<ReconnectingPulse> createState() => _ReconnectingPulseState();
}

class _ReconnectingPulseState extends State<ReconnectingPulse>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final iconSize = widget.iconSize ?? widget.size + 6;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = Curves.easeInOut.transform(_controller.value);
        return SizedBox(
          width: iconSize + 8,
          height: iconSize + 8,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: widget.size + 8 + (t * 6),
                height: widget.size + 8 + (t * 6),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: widget.color.withValues(alpha: 0.12 + (t * 0.12)),
                ),
              ),
              Icon(
                Icons.satellite_alt_rounded,
                size: iconSize,
                color: Color.lerp(
                  widget.color.withValues(alpha: 0.72),
                  widget.color,
                  t,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class ReconnectingStatusChip extends StatelessWidget {
  const ReconnectingStatusChip({
    super.key,
    required this.label,
    this.compact = false,
  });

  final String label;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ReconnectingPulse(size: compact ? 5 : 6, iconSize: compact ? 12 : 14),
        SizedBox(width: compact ? 2 : 4),
        Text(
          label,
          style: TextStyle(
            fontSize: compact ? 10 : 11,
            fontWeight: FontWeight.w700,
            color: GuardianColors.accent,
          ),
        ),
      ],
    );
  }
}

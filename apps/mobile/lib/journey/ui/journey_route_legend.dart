import 'package:flutter/material.dart';

import 'journey_screen_theme.dart';

/// Optional bottom-center route marker legend.
class JourneyRouteLegend extends StatelessWidget {
  const JourneyRouteLegend({
    super.key,
    required this.trackedPersonLabel,
    required this.trackedPersonColor,
    this.visible = true,
  });

  final String trackedPersonLabel;
  final Color trackedPersonColor;
  final bool visible;

  @override
  Widget build(BuildContext context) {
    if (!visible) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: JourneyScreenTheme.glassOverlay(radius: 999),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _LegendDot(color: JourneyScreenTheme.markerStart, label: 'Start'),
          const _LegendDivider(),
          _LegendDot(color: JourneyScreenTheme.markerStop, label: 'Stop'),
          const _LegendDivider(),
          _LegendDot(color: JourneyScreenTheme.markerEnd, label: 'End'),
          const _LegendDivider(),
          _LegendDot(
            color: trackedPersonColor,
            label: trackedPersonLabel,
            pulse: true,
          ),
        ],
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({
    required this.color,
    required this.label,
    this.pulse = false,
  });

  final Color color;
  final String label;
  final bool pulse;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        pulse
            ? _PulsingDot(color: color)
            : Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
        const SizedBox(width: 4),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: JourneyScreenTheme.textStyle(
            fontSize: 10,
            fontWeight: FontWeight.w600,
            color: JourneyScreenTheme.textPrimary,
          ),
        ),
      ],
    );
  }
}

class _PulsingDot extends StatefulWidget {
  const _PulsingDot({required this.color});

  final Color color;

  @override
  State<_PulsingDot> createState() => _PulsingDotState();
}

class _PulsingDotState extends State<_PulsingDot> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final scale = 1.0 + (_controller.value * 0.4);
        return Container(
          width: 8 * scale,
          height: 8 * scale,
          decoration: BoxDecoration(
            color: widget.color.withValues(alpha: 1.0 - _controller.value * 0.3),
            shape: BoxShape.circle,
          ),
          child: child,
        );
      },
      child: Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle),
      ),
    );
  }
}

class _LegendDivider extends StatelessWidget {
  const _LegendDivider();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Container(
        width: 1,
        height: 12,
        color: JourneyScreenTheme.textMuted.withValues(alpha: 0.45),
      ),
    );
  }
}

import 'dart:ui';

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

class GuardianCard extends StatelessWidget {
  const GuardianCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = GuardianRadius.large,
    this.glass = false,
    this.color,
    this.onTap,
    this.borderColor,
    this.elevation = 1,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final bool glass;
  final Color? color;
  final VoidCallback? onTap;
  final Color? borderColor;
  final double elevation;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final content = Material(
      color: color ?? (glass ? colors.glass : colors.surface),
      borderRadius: BorderRadius.circular(radius),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(radius),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(
              color: borderColor ?? (glass
                  ? Colors.white.withValues(alpha: 0.45)
                  : colors.border),
            ),
            boxShadow: [
              BoxShadow(
                color: colors.textPrimary.withValues(
                  alpha: 0.035 + (elevation * 0.018),
                ),
                blurRadius: 18 + (elevation * 6),
                offset: Offset(0, 6 + (elevation * 3)),
              ),
            ],
          ),
          child: child,
        ),
      ),
    );

    if (!glass) return content;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: content,
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../theme/colors.dart';

/// Shared card treatment. The fill is painted in ink so descendant controls,
/// list tiles and expansion tiles retain their Material interaction surface.
class GuardianSurface extends StatelessWidget {
  const GuardianSurface({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = 24,
    this.color,
    this.tint,
    this.tonal = false,
    this.borderColor,
    this.borderWidth = 1,
    this.elevation = 1,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius, borderWidth, elevation;
  final Color? color, tint, borderColor;
  final bool tonal;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final highContrast =
        MediaQuery.maybeOf(context)?.highContrast == true ||
        colors.border == GuardianThemeColors.elderCare.border;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final base = highContrast ? colors.surface : color ?? colors.surface;
    final tone = tint ?? colors.accent;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius),
      side: BorderSide(
        color: borderColor ??
            (highContrast ? colors.textPrimary : colors.border),
        width: highContrast && borderWidth < 2 ? 2 : borderWidth,
      ),
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        boxShadow: highContrast || elevation <= 0
            ? null
            : [
                BoxShadow(
                  color: (dark ? Colors.black : colors.textPrimary)
                      .withValues(alpha: dark ? .16 : .035),
                  blurRadius: 16 + elevation * 4,
                  offset: Offset(0, 3 + elevation),
                ),
              ],
      ),
      child: Material(
        color: base,
        shape: shape,
        clipBehavior: Clip.antiAlias,
        child: Ink(
          decoration: BoxDecoration(
            gradient: highContrast
                ? null
                : LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    stops: const [0, .48, 1],
                    colors: [
                      Color.lerp(base, tone, tonal ? .055 : .015)!,
                      Color.lerp(base, tone, tonal ? .025 : .003)!,
                      Color.lerp(base, tone, tonal ? .13 : .045)!,
                    ],
                  ),
          ),
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}
